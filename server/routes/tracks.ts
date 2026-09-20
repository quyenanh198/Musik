import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { COVER_TYPES, MAX_COVER_BYTES, readTags, removeCover, saveCover } from '../metadata.js';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';
import type { AudioExtractClient } from '../audioextract.js';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Re-decode a multipart filename that was read as latin1 but was sent as UTF-8. */
export function fixFilename(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

/** Where per-track cover images live (next to the audio files). */
export const coverDirOf = (uploadDir: string) => path.join(uploadDir, 'covers');

/** Editable text/number fields, as sent by the client. */
type TrackPatch = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre' | 'year'>>;

const readYear = (raw: unknown): number | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new HttpError(400, 'Invalid year');
  return n;
};

export function tracksRouter(db: Db, uploadDir: string, audioExtract?: AudioExtractClient): Router {
  const router = Router();
  const coverDir = coverDirOf(uploadDir);

  const selectSource = db.prepare(
    "SELECT id, source_path AS sourcePath FROM tracks WHERE id = ? AND source_app = 'audioextract' AND source_path IS NOT NULL",
  );
  const updateSourcePath = db.prepare('UPDATE tracks SET source_path = ? WHERE id = ?');

  /**
   * Carry a title change back to AudioExtract so the file there keeps the same name.
   * Best effort on purpose: the edit here already succeeded, and the remote can be
   * down, the file expired, or the new name taken — none of that should surface as a
   * failed edit. Renaming many tracks to one title only wins for the first of them.
   */
  const renameAtSource = async (ids: number[], title: string) => {
    if (!audioExtract?.configured) return;
    for (const id of ids) {
      const row = selectSource.get(id) as unknown as { id: number; sourcePath: string } | undefined;
      if (!row) continue;
      const renamed = await audioExtract.rename(row.sourcePath, title);
      if (renamed) updateSourcePath.run(renamed.path, id);
    }
  };

  const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_COVER_BYTES },
    fileFilter: (_req, file, cb) => {
      if (COVER_TYPES[file.mimetype.toLowerCase()]) cb(null, true);
      else cb(new HttpError(415, 'Cover must be a JPEG, PNG, WebP or GIF image'));
    },
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('audio/')) cb(null, true);
      else cb(new HttpError(415, 'Only audio files are accepted'));
    },
  });

  const selectOne = db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`);
  const selectFile = db.prepare('SELECT filename, mime_type AS mimeType, cover FROM tracks WHERE id = ?');

  const getTrack = (id: string): Track => {
    const track = selectOne.get(Number(id)) as Track | undefined;
    if (!track) throw new HttpError(404, 'Track not found');
    return track;
  };

  router.get('/', (_req, res) => {
    res.json(db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks ORDER BY created_at DESC, id DESC`).all());
  });

  router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Missing "file" field');

    let cover: string | null = null;
    try {
      // Browsers send multipart names as UTF-8, while busboy exposes them as latin1.
      const tags = await readTags(file.path, path.parse(fixFilename(file.originalname)).name, true);
      cover = tags.picture ? await saveCover(coverDir, tags.picture.data, tags.picture.format) : null;
      const result = db
        .prepare(
          'INSERT INTO tracks (title, artist, album, year, genre, cover, duration, mime_type, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(tags.title, tags.artist, tags.album, tags.year, tags.genre, cover, tags.duration, file.mimetype, file.size, file.filename);
      res.status(201).json(getTrack(String(result.lastInsertRowid)));
    } catch (error) {
      await unlink(file.path).catch(() => {});
      await removeCover(coverDir, cover);
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, 'File contents are not recognized as audio');
    }
  });

  const readIds = (body: unknown): number[] => {
    const raw = (typeof body === 'object' && body !== null ? (body as { ids?: unknown }).ids : undefined) ?? [];
    const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n)) : [];
    if (ids.length === 0 || (Array.isArray(raw) && ids.length !== raw.length)) throw new HttpError(400, '"ids" is required');
    return [...new Set(ids)];
  };

  /** Bulk edit: `{ ids, patch: { title?, artist?, album?, genre?, year? } }` — only the fields present are changed, on every id. */
  router.patch('/', async (req, res) => {
    const ids = readIds(req.body);
    const patch = ((req.body as { patch?: unknown }).patch ?? {}) as TrackPatch;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (typeof patch.title === 'string' && patch.title.trim()) { sets.push('title = ?'); values.push(patch.title.trim()); }
    if (typeof patch.artist === 'string') { sets.push('artist = ?'); values.push(patch.artist.trim()); }
    if (typeof patch.album === 'string') { sets.push('album = ?'); values.push(patch.album.trim()); }
    if (typeof patch.genre === 'string') { sets.push('genre = ?'); values.push(patch.genre.trim()); }
    const year = readYear(patch.year);
    if (year !== undefined) { sets.push('year = ?'); values.push(year); }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    const update = db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`);
    db.exec('BEGIN');
    try {
      for (const id of ids) update.run(...values, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (typeof patch.title === 'string' && patch.title.trim()) await renameAtSource(ids, patch.title.trim());
    const placeholders = ids.map(() => '?').join(',');
    res.json(db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id IN (${placeholders})`).all(...ids));
  });

  /** Bulk delete: `{ ids }` — removes rows and files; unknown ids are ignored. */
  router.post('/delete', async (req, res) => {
    const ids = readIds(req.body);
    const files: string[] = [];
    const covers: (string | null)[] = [];
    for (const id of ids) {
      const row = selectFile.get(id) as { filename: string; cover: string | null } | undefined;
      if (!row) continue;
      db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
      files.push(row.filename);
      covers.push(row.cover);
    }
    await Promise.all([
      ...files.map((f) => unlink(path.join(uploadDir, f)).catch(() => {})),
      ...covers.map((c) => removeCover(coverDir, c)),
    ]);
    res.json({ deleted: files.length });
  });

  /** Same cover image for many tracks (album art): multipart `file` + `ids` (JSON array). */
  router.post('/cover', coverUpload.single('file'), async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String((req.body as { ids?: string }).ids ?? '[]'));
    } catch {
      throw new HttpError(400, '"ids" must be a JSON array');
    }
    const ids = readIds({ ids: raw });
    if (!req.file) throw new HttpError(400, 'Missing "file" field');
    const updated: Track[] = [];
    for (const id of ids) {
      const row = selectFile.get(id) as { cover: string | null } | undefined;
      if (!row) continue;
      const name = await saveCover(coverDir, req.file.buffer, req.file.mimetype);
      db.prepare('UPDATE tracks SET cover = ? WHERE id = ?').run(name, id);
      await removeCover(coverDir, row.cover);
      updated.push(getTrack(String(id)));
    }
    res.json(updated);
  });

  router.get('/:id', (req, res) => {
    res.json(getTrack(req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const current = getTrack(req.params.id);
    const body = req.body as TrackPatch;
    const year = readYear(body.year);
    const next = {
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : current.title,
      artist: typeof body.artist === 'string' ? body.artist.trim() : current.artist,
      album: typeof body.album === 'string' ? body.album.trim() : current.album,
      genre: typeof body.genre === 'string' ? body.genre.trim() : current.genre,
      year: year === undefined ? current.year : year,
    };
    db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, genre = ?, year = ? WHERE id = ?').run(
      next.title,
      next.artist,
      next.album,
      next.genre,
      next.year,
      current.id,
    );
    if (next.title !== current.title) await renameAtSource([current.id], next.title);
    res.json(getTrack(req.params.id));
  });

  router.delete('/:id', async (req, res) => {
    const row = selectFile.get(Number(req.params.id)) as { filename: string; cover: string | null } | undefined;
    if (!row) throw new HttpError(404, 'Track not found');
    db.prepare('DELETE FROM tracks WHERE id = ?').run(Number(req.params.id));
    await unlink(path.join(uploadDir, row.filename)).catch(() => {});
    await removeCover(coverDir, row.cover);
    res.status(204).end();
  });

  router.get('/:id/cover', (req, res) => {
    const row = selectFile.get(Number(req.params.id)) as { cover: string | null } | undefined;
    if (!row) throw new HttpError(404, 'Track not found');
    if (!row.cover) throw new HttpError(404, 'No cover');
    res.sendFile(row.cover, { root: coverDir, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
  });

  router.post('/:id/cover', coverUpload.single('file'), async (req, res) => {
    const current = getTrack(String(req.params.id));
    if (!req.file) throw new HttpError(400, 'Missing "file" field');
    const name = await saveCover(coverDir, req.file.buffer, req.file.mimetype);
    db.prepare('UPDATE tracks SET cover = ? WHERE id = ?').run(name, current.id);
    await removeCover(coverDir, current.cover);
    res.json(getTrack(String(current.id)));
  });

  router.delete('/:id/cover', async (req, res) => {
    const current = getTrack(String(req.params.id));
    db.prepare('UPDATE tracks SET cover = NULL WHERE id = ?').run(current.id);
    await removeCover(coverDir, current.cover);
    res.json(getTrack(String(current.id)));
  });

  // res.sendFile handles Range requests, so seeking works in the browser.
  router.get('/:id/stream', (req, res) => {
    const row = selectFile.get(Number(req.params.id)) as { filename: string; mimeType: string } | undefined;
    if (!row) throw new HttpError(404, 'Track not found');
    res.sendFile(row.filename, {
      root: uploadDir,
      headers: { 'Content-Type': row.mimeType },
    });
  });

  return router;
}
