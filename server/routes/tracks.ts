import { Router } from 'express';
import multer from 'multer';
import { parseFile } from 'music-metadata';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db.js';
import { TRACK_COLUMNS } from '../db.js';
import type { Track } from '../../shared/types.js';
import { HttpError } from '../errors.js';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Re-decode a multipart filename that was read as latin1 but was sent as UTF-8. */
export function fixFilename(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

export function tracksRouter(db: Db, uploadDir: string): Router {
  const router = Router();

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
  const selectFile = db.prepare('SELECT filename, mime_type AS mimeType FROM tracks WHERE id = ?');

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

    // Trình duyệt gửi tên file multipart bằng UTF-8 nhưng busboy/multer giải mã theo
    // latin1, nên tên tiếng Việt/tiếng Trung thành "Chuyá»n hoÃ¡..." — đọc lại đúng mã.
    let title = path.parse(fixFilename(file.originalname)).name;
    let artist = '';
    let album = '';
    let duration = 0;
    try {
      const meta = await parseFile(file.path, { duration: true });
      title = meta.common.title?.trim() || title;
      artist = meta.common.artist?.trim() ?? '';
      album = meta.common.album?.trim() ?? '';
      duration = meta.format.duration ?? 0;
    } catch {
      // Unparseable tags: keep filename-derived title.
    }

    const result = db
      .prepare(
        'INSERT INTO tracks (title, artist, album, duration, mime_type, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(title, artist, album, duration, file.mimetype, file.size, file.filename);
    res.status(201).json(getTrack(String(result.lastInsertRowid)));
  });

  router.get('/:id', (req, res) => {
    res.json(getTrack(req.params.id));
  });

  router.patch('/:id', (req, res) => {
    const current = getTrack(req.params.id);
    const body = req.body as Partial<Pick<Track, 'title' | 'artist' | 'album'>>;
    const next = {
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : current.title,
      artist: typeof body.artist === 'string' ? body.artist.trim() : current.artist,
      album: typeof body.album === 'string' ? body.album.trim() : current.album,
    };
    db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?').run(
      next.title,
      next.artist,
      next.album,
      current.id,
    );
    res.json(getTrack(req.params.id));
  });

  router.delete('/:id', async (req, res) => {
    const row = selectFile.get(Number(req.params.id)) as { filename: string } | undefined;
    if (!row) throw new HttpError(404, 'Track not found');
    db.prepare('DELETE FROM tracks WHERE id = ?').run(Number(req.params.id));
    await unlink(path.join(uploadDir, row.filename)).catch(() => {});
    res.status(204).end();
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
