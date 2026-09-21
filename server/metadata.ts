import { parseFile } from 'music-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db.js';

export interface Tags {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  duration: number;
  /** Embedded front cover, if the file has one. */
  picture?: { data: Uint8Array; format: string };
}

/** Read what the file says about itself; `fallbackTitle` (the file name) when it has no tags. */
export async function readTags(filePath: string, fallbackTitle: string, strict = false): Promise<Tags> {
  const tags: Tags = { title: fallbackTitle, artist: '', album: '', year: null, genre: '', duration: 0 };
  try {
    const meta = await parseFile(filePath, { duration: true });
    if (strict && !meta.format.container && !meta.format.codec) {
      throw new Error('No audio container or codec detected');
    }
    tags.title = meta.common.title?.trim() || fallbackTitle;
    tags.artist = meta.common.artist?.trim() ?? '';
    tags.album = meta.common.album?.trim() ?? '';
    tags.year = Number.isInteger(meta.common.year) ? (meta.common.year as number) : null;
    tags.genre = meta.common.genre?.[0]?.trim() ?? '';
    tags.duration = meta.format.duration ?? 0;
    const pic = meta.common.picture?.find((p) => /front|cover/i.test(p.type ?? '')) ?? meta.common.picture?.[0];
    if (pic && pic.data.length > 0) tags.picture = { data: pic.data, format: pic.format };
  } catch (error) {
    if (strict) throw error;
    // Unparseable tags: keep the filename-derived title.
  }
  return tags;
}

/** What a client claims a cover is. A cheap first gate only: `sniffImage` looks at the bytes. */
export const COVER_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** What the bytes really are, from the file signature; null for anything that is not JPEG, PNG, GIF or WebP. */
export function sniffImage(data: Uint8Array): { mime: string; ext: string } | null {
  if (data.length < 12) return null;
  const ascii = (start: number, text: string) => [...text].every((char, i) => data[start + i] === char.charCodeAt(0));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (data[0] === 0x89 && ascii(1, 'PNG') && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { mime: 'image/gif', ext: '.gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { mime: 'image/webp', ext: '.webp' };
  return null;
}

/**
 * Store cover bytes under `coverDir`; returns the file name to keep in the DB, or null when the bytes are not a
 * usable image (empty, too large, or not really JPEG/PNG/GIF/WebP whatever the upload claimed).
 */
export async function saveCover(coverDir: string, data: Uint8Array): Promise<string | null> {
  const kind = sniffImage(data);
  if (!kind || data.length > MAX_COVER_BYTES) return null;
  await mkdir(coverDir, { recursive: true });
  const name = `${randomUUID()}${kind.ext}`;
  await writeFile(path.join(coverDir, name), data);
  return name;
}

/**
 * Delete a cover file once no track points at it any more. One image can be shared by many tracks (album art),
 * so call this after the rows that used it were updated or deleted.
 */
export async function releaseCover(db: Db, coverDir: string, name: string | null | undefined): Promise<void> {
  if (!name) return;
  const { uses } = db.prepare('SELECT COUNT(*) AS uses FROM tracks WHERE cover = ?').get(name) as unknown as { uses: number };
  if (uses === 0) await unlink(path.join(coverDir, name)).catch(() => {});
}
