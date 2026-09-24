import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { COVER_TYPES, MAX_COVER_BYTES, readTags, releaseCover, saveCover, sniffImage } from '../metadata.js';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';
import { findDuplicate } from '../duplicates.js';
import type { AudioExtractClient } from '../audioextract.js';
import { isRecord, limitedText, safeExtension, toIds } from '../validation.js';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Renaming at the source is best effort; past this budget the remaining tracks are left alone. */
const RENAME_BUDGET_MS = 10_000;

/** Re-decode a multipart filename that was read as latin1 but was sent as UTF-8. */
export function fixFilename(name: string): string {
  if (!/[-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Where per-track cover images live (next to the audio files). */
export const coverDirOf = (uploadDir: string) => path.join(uploadDir, 'covers');

/** The editable fields that were present and valid in a request. */
export type TrackFields = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre' | 'year'>>;

const readYear = (raw: unknown): number | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new HttpError(400, 'Invalid year');
  return n;
};

const TEXT_FIELDS = ['artist', 'album', 'genre'] as const;

/** Pick the editable fields out of an untrusted body. Missing or wrongly typed fields are ignored, bad values are 400. */
export function parseTrackPatch(raw: unknown): TrackFields {
  const source = isRecord(raw) ? raw : {};
  const fields: TrackFields = {};
  if (typeof source.title === 'string' && source.title.trim()) fields.title = limitedText(source.title, 'title');
  for (const key of TEXT_FIELDS) {
    const value = source[key];
    if (typeof value === 'string') fields[key] = limitedText(value, key);
  }
  const year = readYear(source.year);
  if (year !== undefined) fields.year = year;
  return fields;
}

export function tracksRouter(db: Db, uploadDir: string, audioExtract?: AudioExtractClient): Router {
  const router = Router();
  const coverDir = coverDirOf(uploadDir);
  const selectByTitle = db.prepare(
    'SELECT id, title, duration, size FROM tracks WHERE lower(trim(title)) = lower(trim(?))',
  );

  const selectSource = db.prepare(
    "SELECT id, source_path AS sourcePath FROM tracks WHERE id = ? AND source_app = 'audioextract' AND source_path IS NOT NULL",
  );
  const updateSourcePath = db.prepare('UPDATE tracks SET source_path = ? WHERE id = ?');

  /**
   * Carry a title change back to AudioExtract so the file there keeps the same name.
   * Best effort on purpose: the edit here already succeeded, and the remote can be
   * down, the file expired, or the new name taken — none of that should surface as a
   * failed edit. Each rename is short-timed and the whole batch has a budget, so an
   * unreachable remote cannot hold the response for minutes. Renaming many tracks to
   * one title only wins for the first of them.
   */
  const renameAtSource = async (ids: number[], title: string) => {
    if (!audioExtract?.configured) return;
    const deadline = Date.now() + RENAME_BUDGET_MS;
    for (const id of ids) {
      if (Date.now() > deadline) break;
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
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${safeExtension(file.originalname)}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('audio/')) cb(null, true);
      else cb(new HttpError(415, 'Only audio files are accepted'));
    },
  });

  const selectOne = db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`);
  const selectFile = db.prepare('SELECT filename, mime_type AS mimeType, cover FROM tracks WHERE id = ?');
  const deleteRow = db.prepare('DELETE FROM tracks WHERE id = ?');
  const setCover = db.prepare('UPDATE tracks SET cover = ? WHERE id = ?');

  const getTrack = (id: string | number): Track => {
    const track = selectOne.get(Number(id)) as Track | undefined;
    if (!track) throw new HttpError(404, 'Track not found');
    return track;
  };

  /** Same edit on every id, all or nothing. */
  const applyFields = (ids: number[], fields: TrackFields) => {
    const columns = Object.keys(fields); // only ever the keys parseTrackPatch produces
    const update = db.prepare(`UPDATE tracks SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
    const values = Object.values(fields) as (string | number | null)[];
    db.exec('BEGIN');
    try {
      for (const id of ids) update.run(...values, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const readIds = (raw: unknown): number[] => {
    const ids = toIds(raw);
    if (!ids) throw new HttpError(400, '"ids" must be a non-empty list of track ids');
    return ids;
  };

  /** The bytes of an uploaded cover, refused unless they really are an image. */
  const coverBytes = (file: Express.Multer.File | undefined): Buffer => {
    if (!file) throw new HttpError(400, 'Missing "file" field');
    if (!sniffImage(file.buffer)) throw new HttpError(400, 'Cover file is empty or not a JPEG, PNG, WebP or GIF image');
    return file.buffer;
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
      // Tải lại đúng bài đã có (hay gặp: một bản nhập từ AudioExtract, một bản tự tải rồi
      // kéo lên) thì trả về bản cũ thay vì thêm dòng thứ hai — thư viện từng đầy những cặp
      // như vậy, tìm một bài ra hai kết quả.
      const twin = findDuplicate(
        selectByTitle.all(tags.title) as unknown as { id: number; title: string; duration: number | null; size: number }[],
        { title: tags.title, duration: tags.duration, size: file.size },
      );
      if (twin) {
        await unlink(file.path).catch(() => {});
        res.json({ ...(getTrack(twin.id) as object), alreadyInLibrary: true });
        return;
      }
      cover = tags.picture ? await saveCover(coverDir, tags.picture.data) : null;
      const result = db
        .prepare(
          'INSERT INTO tracks (title, artist, album, year, genre, cover, duration, mime_type, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(tags.title, tags.artist, tags.album, tags.year, tags.genre, cover, tags.duration, file.mimetype, file.size, file.filename);
      res.status(201).json(getTrack(result.lastInsertRowid as number));
    } catch (error) {
      await unlink(file.path).catch(() => {});
      await releaseCover(db, coverDir, cover);
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, 'File contents are not recognized as audio');
    }
  });

  /** Bulk edit: `{ ids, patch: { title?, artist?, album?, genre?, year? } }` — only the fields present are changed, on every id. */
  router.patch('/', async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const ids = readIds(body.ids);
    const fields = parseTrackPatch(body.patch);
    if (Object.keys(fields).length === 0) throw new HttpError(400, 'Nothing to update');
    applyFields(ids, fields);
    if (fields.title !== undefined) await renameAtSource(ids, fields.title);
    const placeholders = ids.map(() => '?').join(',');
    res.json(db.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id IN (${placeholders})`).all(...ids));
  });

  /** Bulk delete: `{ ids }` — removes rows and files; unknown ids are ignored. */
  router.post('/delete', async (req, res) => {
    const ids = readIds(isRecord(req.body) ? req.body.ids : undefined);
    const files: string[] = [];
    const covers = new Set<string>();
    for (const id of ids) {
      const row = selectFile.get(id) as { filename: string; cover: string | null } | undefined;
      if (!row) continue;
      deleteRow.run(id);
      files.push(row.filename);
      if (row.cover) covers.add(row.cover);
    }
    await Promise.all([
      ...files.map((f) => unlink(path.join(uploadDir, f)).catch(() => {})),
      ...[...covers].map((c) => releaseCover(db, coverDir, c)),
    ]);
    res.json({ deleted: files.length });
  });

  /** Same cover image for many tracks (album art): multipart `file` + `ids` (JSON array). The image is stored once. */
  router.post('/cover', coverUpload.single('file'), async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String((req.body as { ids?: string }).ids ?? '[]'));
    } catch {
      throw new HttpError(400, '"ids" must be a JSON array');
    }
    const ids = readIds(raw);
    const data = coverBytes(req.file);
    const name = await saveCover(coverDir, data);
    if (!name) throw new HttpError(400, 'Cover could not be stored');
    const replaced = new Set<string>();
    const updated: number[] = [];
    for (const id of ids) {
      const row = selectFile.get(id) as { cover: string | null } | undefined;
      if (!row) continue;
      setCover.run(name, id);
      if (row.cover) replaced.add(row.cover);
      updated.push(id);
    }
    // Old files go only when no other track still shows them; a batch that matched nothing leaves no orphan.
    for (const old of replaced) if (old !== name) await releaseCover(db, coverDir, old);
    if (updated.length === 0) await releaseCover(db, coverDir, name);
    res.json(updated.map((id) => getTrack(id)));
  });

  router.get('/:id', (req, res) => {
    res.json(getTrack(req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const current = getTrack(req.params.id);
    const fields = parseTrackPatch(req.body);
    if (Object.keys(fields).length > 0) applyFields([current.id], fields);
    if (fields.title !== undefined && fields.title !== current.title) await renameAtSource([current.id], fields.title);
    res.json(getTrack(current.id));
  });

  router.delete('/:id', async (req, res) => {
    const row = selectFile.get(Number(req.params.id)) as { filename: string; cover: string | null } | undefined;
    if (!row) throw new HttpError(404, 'Track not found');
    deleteRow.run(Number(req.params.id));
    await unlink(path.join(uploadDir, row.filename)).catch(() => {});
    await releaseCover(db, coverDir, row.cover);
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
    const data = coverBytes(req.file);
    const name = await saveCover(coverDir, data);
    if (!name) throw new HttpError(400, 'Cover could not be stored');
    setCover.run(name, current.id);
    await releaseCover(db, coverDir, current.cover);
    res.json(getTrack(current.id));
  });

  router.delete('/:id/cover', async (req, res) => {
    const current = getTrack(req.params.id);
    setCover.run(null, current.id);
    await releaseCover(db, coverDir, current.cover);
    res.json(getTrack(current.id));
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
