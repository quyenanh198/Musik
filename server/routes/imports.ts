import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';
import { addTracksToPlaylist } from './playlists.js';
import { readTags, removeCover, saveCover } from '../metadata.js';
import { coverDirOf } from './tracks.js';
import { createAudioExtractClient, sourceIdOf, type AudioExtractClient, type RemoteFile } from '../audioextract.js';

export interface ImportOptions {
  /** Base URL of the AudioExtract server (docker network), e.g. http://audioextract:3000. */
  audioExtractUrl?: string;
  maxBytes?: number;
  /** Pre-built client; the URL is used when this is omitted. */
  audioExtract?: AudioExtractClient;
}

export const MAX_REMOTE_BYTES = 200 * 1024 * 1024;

export type { RemoteFile };

/** A remote file plus what Musik already knows about it. */
export interface RemoteFileStatus extends RemoteFile {
  /** The track already imported from this file, or null. */
  trackId: number | null;
  /** That track's title, so the picker can show what it became. */
  title: string | null;
}

/** Pull finished AudioExtract results into the library: list what's on that server, copy chosen files over. */
export function importsRouter(
  db: Db,
  uploadDir: string,
  { audioExtractUrl, maxBytes = MAX_REMOTE_BYTES, audioExtract }: ImportOptions,
): Router {
  const router = Router();
  const remote = audioExtract ?? createAudioExtractClient(audioExtractUrl);

  const coverDir = coverDirOf(uploadDir);
  const selectOne = db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`);
  const selectBySource = db.prepare(
    "SELECT id, title, source_path AS sourcePath FROM tracks WHERE source_app = 'audioextract' AND source_id = ?",
  );

  /**
   * Which track, if any, came from this remote file. Matching is by the stable
   * directory id, so a file renamed on the AudioExtract side is still recognised —
   * unless that directory holds several files, where only the exact path is safe.
   */
  const importedFrom = (file: RemoteFile, ambiguousDirs: Set<string>) => {
    const rows = selectBySource.all(sourceIdOf(file.path)) as unknown as {
      id: number;
      title: string;
      sourcePath: string | null;
    }[];
    if (rows.length === 0) return null;
    const exact = rows.find((r) => r.sourcePath === file.path);
    if (exact) return exact;
    if (rows.length > 1 || ambiguousDirs.has(sourceIdOf(file.path))) return null;
    return rows[0];
  };

  const nameOf = (p: string) => path.parse(p).name;

  router.get('/sources', (_req, res) => {
    res.json({ audioextract: remote.configured });
  });

  /**
   * The remote list, annotated with what Musik already imported. A file renamed on
   * the AudioExtract side is carried over here (title and stored path), which is the
   * pull half of keeping both apps in step; the push half lives in the tracks router.
   */
  router.get('/audioextract', async (_req, res) => {
    const list = await remote.listFiles();
    const perDir = new Map<string, number>();
    for (const file of list) perDir.set(sourceIdOf(file.path), (perDir.get(sourceIdOf(file.path)) ?? 0) + 1);
    const ambiguousDirs = new Set([...perDir].filter(([, n]) => n > 1).map(([dir]) => dir));
    const renamed = db.prepare('UPDATE tracks SET title = ?, source_path = ? WHERE id = ?');
    const out: RemoteFileStatus[] = list.map((file) => {
      const match = importedFrom(file, ambiguousDirs);
      if (!match) return { ...file, trackId: null, title: null };
      // Renamed over there since the last sync: take the new name, the user meant it.
      if (match.sourcePath !== file.path) {
        const title = nameOf(file.name);
        renamed.run(title, file.path, match.id);
        return { ...file, trackId: match.id, title };
      }
      return { ...file, trackId: match.id, title: match.title };
    });
    res.json(out);
  });

  /**
   * `{ paths: string[] }` or `{ items: [{ path, title? }] }`, plus optional `playlistId`
   * → copies each file in (a given title overrides the tag/filename), returns what landed and what failed.
   */
  router.post('/audioextract', async (req, res) => {
    const body = (req.body ?? {}) as { paths?: unknown; items?: unknown; playlistId?: unknown };
    const items: { path: string; title?: string }[] = [];
    if (Array.isArray(body.items)) {
      for (const it of body.items) {
        if (it && typeof it === 'object' && typeof (it as { path?: unknown }).path === 'string' && (it as { path: string }).path) {
          const title = (it as { title?: unknown }).title;
          items.push({ path: (it as { path: string }).path, title: typeof title === 'string' && title.trim() ? title.trim() : undefined });
        }
      }
    }
    if (Array.isArray(body.paths)) {
      for (const p of body.paths) if (typeof p === 'string' && p) items.push({ path: p });
    }
    if (items.length === 0) throw new HttpError(400, '"paths" or "items" is required');
    let playlistId: number | undefined;
    if (body.playlistId !== undefined && body.playlistId !== null && body.playlistId !== '') {
      playlistId = Number(body.playlistId);
      if (!Number.isInteger(playlistId)) throw new HttpError(400, 'Invalid playlistId');
      if (!db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(playlistId)) throw new HttpError(404, 'Playlist not found');
    }

    const imported: Track[] = [];
    const failed: { path: string; error: string }[] = [];
    const skipped: { path: string; trackId: number; title: string }[] = [];
    const seen = new Set<string>();
    for (const { path: rel, title: wanted } of items) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      // Already in the library: adding it again would just duplicate the track.
      const already = importedFrom({ path: rel, name: path.basename(rel), size: 0, updatedAt: '' }, new Set());
      if (already) {
        skipped.push({ path: rel, trackId: already.id, title: already.title });
        continue;
      }
      const name = path.basename(rel);
      const dest = path.join(uploadDir, `${randomUUID()}${path.extname(name)}`);
      let cover: string | null = null;
      try {
        const upstream = await remote.fetchFile(rel);
        const mimeType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
        if (!mimeType.startsWith('audio/')) throw new HttpError(415, `Not an audio file (${mimeType || 'unknown type'})`);
        if (!upstream.body) throw new HttpError(502, 'Empty response');
        const declaredSize = Number(upstream.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new HttpError(413, 'Remote audio file is too large');
        let received = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            callback(received > maxBytes ? new HttpError(413, 'Remote audio file is too large') : null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(upstream.body as never), limit, createWriteStream(dest));
        const { size } = await stat(dest);

        const tags = await readTags(dest, path.parse(name).name, true);
        const title = wanted ?? tags.title;
        cover = tags.picture ? await saveCover(coverDir, tags.picture.data, tags.picture.format) : null;
        const result = db
          .prepare(
            `INSERT INTO tracks (title, artist, album, year, genre, cover, duration, mime_type, size, filename,
               source_app, source_id, source_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'audioextract', ?, ?)`,
          )
          .run(
            title, tags.artist, tags.album, tags.year, tags.genre, cover, tags.duration, mimeType, size,
            path.basename(dest), sourceIdOf(rel), rel,
          );
        imported.push(selectOne.get(Number(result.lastInsertRowid)) as unknown as Track);
      } catch (e) {
        await unlink(dest).catch(() => {});
        await removeCover(coverDir, cover);
        failed.push({ path: rel, error: (e as Error).message });
      }
    }

    if (playlistId !== undefined && imported.length > 0) {
      addTracksToPlaylist(
        db,
        playlistId,
        imported.map((t) => t.id),
      );
    }
    // Nothing imported but nothing broken either (all duplicates) is still a success.
    const status = imported.length > 0 ? 201 : failed.length > 0 ? 502 : 200;
    res.status(status).json({ imported, failed, skipped });
  });

  return router;
}
