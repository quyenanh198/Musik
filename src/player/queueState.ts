import type { Track } from '../../shared/types';
import { moveItem } from '../queueOrder';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * The play queue as plain data. Every change is a pure function from one state to the next, so the rules (what
 * "next" means at the end of the queue, what happens to the playing index when rows move) are testable without an
 * audio element, and nothing runs inside a React state updater.
 */
export interface QueueState {
  queue: Track[];
  /** Position of the current track in `queue`, or -1 when nothing is loaded. */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** The order before shuffling, so turning shuffle off can put it back; null once the user reorders by hand. */
  original: Track[] | null;
  /**
   * Bumped every time playback of `index` has to (re)start, even when `index` points at the same track as before
   * (click the current track again, repeat-all on a one-track queue). The audio loader keys on it.
   */
  token: number;
}

export const emptyQueue: QueueState = { queue: [], index: -1, shuffle: false, repeat: 'off', original: null, token: 0 };

export type Random = () => number;

export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const play = (s: QueueState, patch: Partial<QueueState>): QueueState => ({ ...s, ...patch, token: s.token + 1 });

/** Replace the queue and start at `startIndex`. With shuffle on, that track still plays first. */
export function startQueue(s: QueueState, tracks: readonly Track[], startIndex: number, random: Random = Math.random): QueueState {
  const first = tracks[startIndex];
  if (!first) return s;
  if (!s.shuffle) return play(s, { queue: [...tracks], index: startIndex, original: null });
  const rest = shuffled(tracks.filter((_, i) => i !== startIndex), random);
  return play(s, { queue: [first, ...rest], index: 0, original: [...tracks] });
}

/** Turn shuffle on and play `tracks` in random order. */
export function shuffleAll(s: QueueState, tracks: readonly Track[], random: Random = Math.random): QueueState {
  if (tracks.length === 0) return s;
  return play(s, { shuffle: true, queue: shuffled(tracks, random), index: 0, original: [...tracks] });
}

/** Jump to a position in the queue and play it. */
export function jumpTo(s: QueueState, index: number): QueueState {
  return index < 0 || index >= s.queue.length ? s : play(s, { index });
}

/**
 * The next track. At the end of the queue it wraps with repeat-all; otherwise `stop` is true and the state is left
 * alone, so the caller can stop the audio without losing the queue.
 */
export function advance(s: QueueState): { state: QueueState; stop: boolean } {
  if (s.queue.length === 0) return { state: s, stop: false };
  if (s.index + 1 < s.queue.length) return { state: play(s, { index: s.index + 1 }), stop: false };
  if (s.repeat === 'all') return { state: play(s, { index: 0 }), stop: false };
  return { state: s, stop: true };
}

/** The previous track, or null when already at the first one (the caller restarts it instead). */
export function previous(s: QueueState): QueueState | null {
  return s.index > 0 ? play(s, { index: s.index - 1 }) : null;
}

const keepOnlyQueued = (original: Track[] | null, queue: Track[]): Track[] | null => {
  if (!original) return null;
  const present = new Set(queue.map((t) => t.id));
  return original.filter((t) => present.has(t.id));
};

/** Drop one queue entry by position. Dropping the current one stops playback rather than jumping to another song. */
export function dropAt(s: QueueState, index: number): { state: QueueState; removedCurrent: boolean } {
  if (index < 0 || index >= s.queue.length) return { state: s, removedCurrent: false };
  const queue = s.queue.filter((_, i) => i !== index);
  const original = keepOnlyQueued(s.original, queue);
  if (index === s.index) return { state: { ...s, queue, original, index: -1 }, removedCurrent: true };
  return { state: { ...s, queue, original, index: index < s.index ? s.index - 1 : s.index }, removedCurrent: false };
}

/** Drop a deleted track (every occurrence) from the queue. */
export function dropTrack(s: QueueState, trackId: number): { state: QueueState; removedCurrent: boolean } {
  let index = s.index;
  let removedCurrent = false;
  const queue: Track[] = [];
  s.queue.forEach((track, i) => {
    if (track.id !== trackId) {
      queue.push(track);
      return;
    }
    if (i === s.index) removedCurrent = true;
    else if (i < s.index) index -= 1;
  });
  if (queue.length === s.queue.length) return { state: s, removedCurrent: false };
  return { state: { ...s, queue, original: keepOnlyQueued(s.original, queue), index: removedCurrent ? -1 : index }, removedCurrent };
}

/** Move a queue row. Whatever is playing keeps playing: the index follows the track, not the position. */
export function reorder(s: QueueState, from: number, to: number): QueueState {
  const queue = moveItem(s.queue, from, to);
  if (queue === s.queue) return s;
  const target = Math.max(0, Math.min(s.queue.length - 1, to));
  let index = s.index;
  if (index === from) index = target;
  else if (index >= 0) {
    index -= from < index ? 1 : 0; // where it sits once the moved row is lifted out
    if (target <= index) index += 1; // and once the row is put back in
  }
  return { ...s, queue, index, original: null };
}

/** Shuffle keeps the playing track first and mixes the rest; turning it off restores the earlier order. */
export function setShuffle(s: QueueState, on: boolean, random: Random = Math.random): QueueState {
  if (on === s.shuffle) return s;
  if (on) {
    if (s.index < 0) return { ...s, shuffle: true };
    const current = s.queue[s.index];
    const rest = shuffled(s.queue.filter((_, i) => i !== s.index), random);
    return { ...s, shuffle: true, original: [...s.queue], queue: [current, ...rest], index: 0 };
  }
  if (!s.original) return { ...s, shuffle: false };
  const currentId = s.index >= 0 ? s.queue[s.index].id : null;
  const queue = keepOnlyQueued(s.original, s.queue) ?? s.queue;
  const index = currentId === null ? -1 : queue.findIndex((t) => t.id === currentId);
  return { ...s, shuffle: false, queue, index, original: null };
}

export function cycleRepeat(s: QueueState): QueueState {
  return { ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' };
}

/** Refresh a track's metadata after an edit. */
export function updateTrack(s: QueueState, track: Track): QueueState {
  const swap = (list: Track[]) => list.map((t) => (t.id === track.id ? track : t));
  return { ...s, queue: swap(s.queue), original: s.original ? swap(s.original) : null };
}
