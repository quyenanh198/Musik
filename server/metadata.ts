import { parseFile } from 'music-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export const COVER_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** Store cover bytes under `coverDir`; returns the file name to keep in the DB. */
export async function saveCover(coverDir: string, data: Uint8Array, mime: string): Promise<string | null> {
  const ext = COVER_TYPES[mime.toLowerCase()];
  if (!ext || data.length === 0 || data.length > MAX_COVER_BYTES) return null;
  await mkdir(coverDir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  await writeFile(path.join(coverDir, name), data);
  return name;
}

export async function removeCover(coverDir: string, name: string | null | undefined): Promise<void> {
  if (name) await unlink(path.join(coverDir, name)).catch(() => {});
}
