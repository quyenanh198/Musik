import { Router } from 'express';
import { parseFile } from 'music-metadata';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';
import { addTracksToPlaylist } from './playlists.js';

export interface ImportOptions {
  /** Base URL of the AudioExtract server (docker network), e.g. http://audioextract:3000. */
  audioExtractUrl?: string;
}

export interface RemoteFile {
  path: string;
  name: string;
  size: number;
  updatedAt: string;
}

/** Pull finished AudioExtract results into the library: list what's on that server, copy chosen files over. */
export function importsRouter(db: Db, uploadDir: string, { audioExtractUrl }: ImportOptions): Router {
  const router = Router();
  const base = audioExtractUrl?.replace(/\/$/, '');

  const remote = async (route: string): Promise<Response> => {
    if (!base) throw new HttpError(404, 'AudioExtract is not configured');
    let res: Response;
    try {
      res = await fetch(`${base}${route}`);
    } catch (e) {
      throw new HttpError(502, `AudioExtract unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // keep status text
      }
      throw new HttpError(502, `AudioExtract: ${message}`);
    }
    return res;
  };

  const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
  const selectOne = db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`);

  router.get('/sources', (_req, res) => {
    res.json({ audioextract: Boolean(base) });
  });

  router.get('/audioextract', async (_req, res) => {
    const list = (await (await remote('/api/files')).json()) as RemoteFile[];
    res.json(list);
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
    const seen = new Set<string>();
    for (const { path: rel, title: wanted } of items) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const name = path.basename(rel);
      const dest = path.join(uploadDir, `${randomUUID()}${path.extname(name)}`);
      try {
        const upstream = await remote(`/api/files/${encodePath(rel)}`);
        const mimeType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
        if (!mimeType.startsWith('audio/')) throw new HttpError(415, `Not an audio file (${mimeType || 'unknown type'})`);
        if (!upstream.body) throw new HttpError(502, 'Empty response');
        await pipeline(Readable.fromWeb(upstream.body as never), createWriteStream(dest));
        const { size } = await stat(dest);

        let title = path.parse(name).name;
        let artist = '';
        let album = '';
        let duration = 0;
        try {
          const meta = await parseFile(dest, { duration: true });
          title = meta.common.title?.trim() || title;
          if (wanted) title = wanted;
          artist = meta.common.artist?.trim() ?? '';
          album = meta.common.album?.trim() ?? '';
          duration = meta.format.duration ?? 0;
        } catch {
          // Unparseable tags: keep filename-derived title.
        }
        if (wanted) title = wanted;
        const result = db
          .prepare('INSERT INTO tracks (title, artist, album, duration, mime_type, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(title, artist, album, duration, mimeType, size, path.basename(dest));
        imported.push(selectOne.get(Number(result.lastInsertRowid)) as unknown as Track);
      } catch (e) {
        await unlink(dest).catch(() => {});
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
    res.status(imported.length > 0 ? 201 : 502).json({ imported, failed });
  });

  return router;
}
