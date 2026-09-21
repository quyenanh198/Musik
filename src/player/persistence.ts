import type { Track } from '../../shared/types';
import { emptyQueue, type QueueState, type RepeatMode } from './queueState';

export const PLAYBACK_KEY = 'musik:playback';
const MAX_SAVED_TRACKS = 5000;

/** What survives a reload: which tracks, where in them, and the playback modes. Track details are re-read from the library. */
export interface SavedPlayback {
  ids: number[];
  index: number;
  /** Seconds into the current track. */
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export function serializePlayback(s: QueueState, position: number): SavedPlayback {
  return {
    ids: s.queue.slice(0, MAX_SAVED_TRACKS).map((t) => t.id),
    index: s.index,
    position: Number.isFinite(position) && position > 0 ? Math.floor(position) : 0,
    shuffle: s.shuffle,
    repeat: s.repeat,
  };
}

/** Untrusted text from storage back into a SavedPlayback, or null when it is missing or not what we wrote. */
export function parseSavedPlayback(raw: string | null): SavedPlayback | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const ids = v.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SAVED_TRACKS) return null;
  if (!ids.every((id) => Number.isSafeInteger(id) && (id as number) > 0)) return null;
  const repeat = v.repeat === 'all' || v.repeat === 'one' ? v.repeat : 'off';
  const index = typeof v.index === 'number' && Number.isInteger(v.index) ? v.index : -1;
  const position = typeof v.position === 'number' && Number.isFinite(v.position) && v.position > 0 ? v.position : 0;
  return { ids: ids as number[], index, position, shuffle: v.shuffle === true, repeat };
}

/**
 * Rebuild the queue from what is saved and what the library still has. Tracks deleted since are dropped; if the one
 * that was playing is gone, the queue is kept but starts from the top of the nearest entry.
 */
export function restorePlayback(saved: SavedPlayback, library: readonly Track[]): { state: QueueState; position: number } | null {
  const byId = new Map(library.map((t) => [t.id, t]));
  const queue = saved.ids.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined);
  if (queue.length === 0) return null;
  const playingId = saved.ids[saved.index];
  const found = queue.findIndex((t) => t.id === playingId);
  const index = found === -1 ? Math.min(Math.max(saved.index, 0), queue.length - 1) : found;
  return {
    state: { ...emptyQueue, queue, index, shuffle: saved.shuffle, repeat: saved.repeat },
    position: found === -1 ? 0 : saved.position,
  };
}
