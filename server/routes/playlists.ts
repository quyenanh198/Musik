import { Router } from 'express';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Playlist, PlaylistDetail, Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';

const PLAYLIST_SELECT = `
  SELECT p.id, p.name, p.created_at AS createdAt,
    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS trackCount
  FROM playlists p
`;

export function playlistsRouter(db: Db): Router {
  const router = Router();

  const selectOne = db.prepare(`${PLAYLIST_SELECT} WHERE p.id = ?`);
  const selectTracks = db.prepare(`
    SELECT ${TRACK_COLUMNS} FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `);

  const getPlaylist = (id: string): Playlist => {
    const playlist = selectOne.get(Number(id)) as Playlist | undefined;
    if (!playlist) throw new HttpError(404, 'Playlist not found');
    return playlist;
  };

  const getDetail = (id: string): PlaylistDetail => ({
    ...getPlaylist(id),
    tracks: selectTracks.all(Number(id)) as unknown as Track[],
  });

  const readName = (body: unknown): string => {
    const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, '"name" is required');
    return name.trim();
  };

  router.get('/', (_req, res) => {
    res.json(db.prepare(`${PLAYLIST_SELECT} ORDER BY p.created_at DESC, p.id DESC`).all());
  });

  router.post('/', (req, res) => {
    const result = db.prepare('INSERT INTO playlists (name) VALUES (?)').run(readName(req.body));
    res.status(201).json(getDetail(String(result.lastInsertRowid)));
  });

  router.get('/:id', (req, res) => {
    res.json(getDetail(req.params.id));
  });

  router.patch('/:id', (req, res) => {
    getPlaylist(req.params.id);
    db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(readName(req.body), Number(req.params.id));
    res.json(getDetail(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    getPlaylist(req.params.id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  });

  /** Body `{ trackId }` or `{ trackIds: [...] }` — one request adds many tracks, in the given order. */
  const readTrackIds = (body: unknown): number[] => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { trackId?: unknown; trackIds?: unknown };
    const raw = Array.isArray(b.trackIds) ? b.trackIds : b.trackId !== undefined ? [b.trackId] : [];
    const ids = raw.map(Number).filter((n) => Number.isInteger(n));
    if (ids.length === 0 || ids.length !== raw.length) throw new HttpError(400, '"trackId" or "trackIds" is required');
    return [...new Set(ids)];
  };

  router.post('/:id/tracks', (req, res) => {
    getPlaylist(req.params.id);
    const trackIds = readTrackIds(req.body);
    const exists = db.prepare('SELECT 1 FROM tracks WHERE id = ?');
    const missing = trackIds.filter((id) => !exists.get(id));
    if (missing.length) throw new HttpError(404, `Track not found: ${missing.join(', ')}`);

    const playlistId = Number(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    try {
      let { next } = db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?')
        .get(playlistId) as { next: number };
      for (const trackId of trackIds) {
        if (insert.run(playlistId, trackId, next).changes > 0) next += 1;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json(getDetail(req.params.id));
  });

  /** Remove many tracks at once: `{ trackIds: [...] }`. Ids not in the playlist are ignored. */
  router.post('/:id/tracks/remove', (req, res) => {
    getPlaylist(req.params.id);
    const trackIds = readTrackIds(req.body);
    const del = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?');
    let removed = 0;
    for (const trackId of trackIds) removed += Number(del.run(Number(req.params.id), trackId).changes);
    res.json({ removed, ...getDetail(req.params.id) });
  });

  router.delete('/:id/tracks/:trackId', (req, res) => {
    getPlaylist(req.params.id);
    const result = db
      .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .run(Number(req.params.id), Number(req.params.trackId));
    if (result.changes === 0) throw new HttpError(404, 'Track not in playlist');
    res.status(204).end();
  });

  return router;
}
