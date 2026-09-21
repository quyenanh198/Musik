import { HttpError } from './errors.js';

export const MAX_TEXT_LENGTH = 300;
export const MAX_NAME_LENGTH = 200;
export const MAX_IDS = 10_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trimmed text of at most `max` characters. Longer input is a client error, never silently cut. */
export function limitedText(value: string, field: string, max = MAX_TEXT_LENGTH): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `"${field}" is longer than ${max} characters`);
  return trimmed;
}

/** A positive integer id sent as a number or a string of digits; everything else (booleans, floats, "1e3") is refused. */
export function toId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    const id = Number(value);
    return id > 0 ? id : null;
  }
  return null;
}

/** Distinct ids in the order given, or null when the list is empty, not a list, or holds anything that is not an id. */
export function toIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_IDS) throw new HttpError(400, `At most ${MAX_IDS} ids per request`);
  const ids = raw.map(toId);
  return ids.every((id): id is number => id !== null) ? [...new Set(ids)] : null;
}

/** Stored file extension: short, lowercase, alphanumeric. Anything else is dropped rather than written to disk. */
export function safeExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}
