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
import { readTags, releaseCover, saveCover } from '../metadata.js';
import { coverDirOf } from './tracks.js';
import { createAudioExtractClient, isSafeRemotePath, sourceIdOf, type AudioExtractClient, type RemoteFile } from '../audioextract.js';
import { isRecord, limitedText, safeExtension, toId } from '../validation.js';

export interface ImportOptions {
  /** Base URL of the AudioExtract server (docker network), e.g. http://audioextract:3000. */
  audioExtractUrl?: string;
  maxBytes?: number;
  /** Pre-built client; the URL is used when this is omitted. */
  audioExtract?: AudioExtractClient;
}

export const MAX_REMOTE_BYTES = 200 * 1024 * 1024;
const MAX_ITEMS_PER_IMPORT = 500;

export type { RemoteFile };

/** A remote file plus what Musik already knows about it. */
export interface RemoteFileStatus extends RemoteFile {
  /** The track already imported from this file, or null. */
  trackId: number | null;
  /** That track's title, so the picker can show what it became. */
  title: string | null;
}

interface ImportItem {
  path: string;
  title?: string;
}

type Outcome = { kind: 'imported'; track: Track } | { kind: 'skipped'; trackId: number; title: string };

/** `{ paths: string[] }` and/or `{ items: [{ path, title? }] }` from an untrusted body. */
function parseItems(body: Record<string, unknown>): ImportItem[] {
  const items: ImportItem[] = [];
  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!isRecord(item) || typeof item.path !== 'string' || !item.path) continue;
      const title = typeof item.title === 'string' && item.title.trim() ? limitedText(item.title, 'title') : undefined;
      items.push({ path: item.path, title });
    }
  }
  if (Array.isArray(body.paths)) {
    for (const p of body.paths) if (typeof p === 'string' && p) items.push({ path: p });
  }
  if (items.length === 0) throw new HttpError(400, '"paths" or "items" is required');
  if (items.length > MAX_ITEMS_PER_IMPORT) throw new HttpError(400, `At most ${MAX_ITEMS_PER_IMPORT} files per import`);
  return items;
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
  const selectByPath = db.prepare("SELECT id, title FROM tracks WHERE source_app = 'audioextract' AND source_path = ?");
  // Same song, different result folder: AudioExtract can hold the same download twice,
  // and those are separate files with separate ids. Title plus byte size is what tells
  // them apart from a genuinely new track.
  const selectByContent = db.prepare('SELECT id, title FROM tracks WHERE title = ? AND size = ?');
  const insertTrack = db.prepare(
    `INSERT INTO tracks (title, artist, album, year, genre, cover, duration, mime_type, size, filename,
       source_app, source_id, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'audioextract', ?, ?)`,
  );

  /**
   * Which track, if any, came from this remote file (used when listing). Matching is by the stable
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

  // Imports run one at a time: two requests for the same file would otherwise both download it before either
  // recorded it, and the second would create a duplicate.
  let queue: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  /**
   * Download one remote file into the library. Throws with a user-facing message on failure and leaves nothing on
   * disk; returns `skipped` when the library already has that file (same path, or same title and size).
   */
  const importOne = async (rel: string, wanted: string | undefined, clientGone: AbortSignal): Promise<Outcome> => {
    // Exact path only: the folder is shared by every file of one download, so a sibling is a different file.
    const already = selectByPath.get(rel) as unknown as { id: number; title: string } | undefined;
    if (already) return { kind: 'skipped', trackId: already.id, title: already.title };

    const name = path.basename(rel);
    const dest = path.join(uploadDir, `${randomUUID()}${safeExtension(name)}`);
    let cover: string | null = null;
    let kept = false;
    // A download may take as long as it likes while data keeps arriving; silence for `timeoutMs` stops it.
    const watchdog = new AbortController();
    const stop = AbortSignal.any([clientGone, watchdog.signal]);
    let idle: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => watchdog.abort(new HttpError(504, 'AudioExtract stopped sending data')), remote.timeoutMs);
    };
    try {
      const upstream = await remote.fetchFile(rel, stop);
      const mimeType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!mimeType.startsWith('audio/')) throw new HttpError(415, `Not an audio file (${mimeType || 'unknown type'})`);
      if (!upstream.body) throw new HttpError(502, 'Empty response');
      const declaredSize = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new HttpError(413, 'Remote audio file is too large');
      let received = 0;
      arm();
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          arm();
          received += chunk.length;
          callback(received > maxBytes ? new HttpError(413, 'Remote audio file is too large') : null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(upstream.body as never), limit, createWriteStream(dest), { signal: stop });
      clearTimeout(idle);
      const { size } = await stat(dest);

      const tags = await readTags(dest, path.parse(name).name, true);
      const title = wanted ?? tags.title;
      const twin = selectByContent.get(title, size) as unknown as { id: number; title: string } | undefined;
      if (twin) return { kind: 'skipped', trackId: twin.id, title: twin.title };
      cover = tags.picture ? await saveCover(coverDir, tags.picture.data) : null;
      const result = insertTrack.run(
        title, tags.artist, tags.album, tags.year, tags.genre, cover, tags.duration, mimeType, size,
        path.basename(dest), sourceIdOf(rel), rel,
      );
      kept = true;
      return { kind: 'imported', track: selectOne.get(Number(result.lastInsertRowid)) as unknown as Track };
    } catch (error) {
      // An abort surfaces as a generic AbortError; the watchdog's own reason is the useful message.
      if (stop.aborted && stop.reason instanceof HttpError) throw stop.reason;
      throw error;
    } finally {
      clearTimeout(idle);
      if (!kept) {
        await unlink(dest).catch(() => {});
        await releaseCover(db, coverDir, cover);
      }
    }
  };

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
    const body = isRecord(req.body) ? req.body : {};
    const items = parseItems(body);
    let playlistId: number | undefined;
    if (body.playlistId !== undefined && body.playlistId !== null && body.playlistId !== '') {
      const id = toId(body.playlistId);
      if (id === null) throw new HttpError(400, 'Invalid playlistId');
      if (!db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id)) throw new HttpError(404, 'Playlist not found');
      playlistId = id;
    }

    // If the browser goes away mid-import, stop downloading for nobody.
    const clientGone = new AbortController();
    res.once('close', () => {
      if (!res.writableFinished) clientGone.abort();
    });

    const imported: Track[] = [];
    const failed: { path: string; error: string }[] = [];
    const skipped: { path: string; trackId: number; title: string }[] = [];
    await inOrder(async () => {
      const seen = new Set<string>();
      for (const { path: rel, title } of items) {
        if (clientGone.signal.aborted) return;
        if (seen.has(rel)) continue;
        seen.add(rel);
        if (!isSafeRemotePath(rel)) {
          failed.push({ path: rel, error: 'Invalid path' });
          continue;
        }
        try {
          const outcome = await importOne(rel, title, clientGone.signal);
          if (outcome.kind === 'imported') imported.push(outcome.track);
          else skipped.push({ path: rel, trackId: outcome.trackId, title: outcome.title });
        } catch (e) {
          failed.push({ path: rel, error: (e as Error).message });
        }
      }
    });

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
