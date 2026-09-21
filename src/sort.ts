import type { Track } from '../shared/types';

export type SortKey = 'added' | 'title' | 'artist' | 'album' | 'year' | 'duration';
export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const SORT_KEYS: readonly SortKey[] = ['added', 'title', 'artist', 'album', 'year', 'duration'];
export const SORT_STORAGE_KEY = 'musik:sort';
/** Newest first, which is also the order the server sends. */
export const DEFAULT_SORT: SortState = { key: 'added', direction: 'desc' };

/** The direction people expect when they pick a field: text A to Z, everything else biggest or newest first. */
export const defaultDirection = (key: SortKey): SortDirection => (key === 'title' || key === 'artist' || key === 'album' ? 'asc' : 'desc');

export function parseSort(raw: string | null): SortState {
  if (!raw) return DEFAULT_SORT;
  try {
    const value = JSON.parse(raw) as Partial<SortState> | null;
    const key = SORT_KEYS.find((k) => k === value?.key);
    if (key && (value?.direction === 'asc' || value?.direction === 'desc')) return { key, direction: value.direction };
  } catch {
    // fall through
  }
  return DEFAULT_SORT;
}

// Base sensitivity ignores case and accents, numeric puts "Track 2" before "Track 10"; both matter for Vietnamese titles.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const textOf = (track: Track, key: 'title' | 'artist' | 'album') => track[key].trim();

/** A sorted copy. Tracks with no value for the chosen field always go last, whichever way the list is sorted. */
export function sortTracks(tracks: readonly Track[], { key, direction }: SortState): Track[] {
  const sign = direction === 'asc' ? 1 : -1;
  const compareValue = (a: Track, b: Track): number => {
    switch (key) {
      case 'title':
      case 'artist':
      case 'album': {
        const x = textOf(a, key);
        const y = textOf(b, key);
        if ((x === '') !== (y === '')) return x === '' ? 1 : -1;
        return sign * collator.compare(x, y);
      }
      case 'year': {
        if ((a.year === null) !== (b.year === null)) return a.year === null ? 1 : -1;
        return sign * ((a.year ?? 0) - (b.year ?? 0));
      }
      case 'duration': {
        if ((a.duration > 0) !== (b.duration > 0)) return a.duration > 0 ? -1 : 1;
        return sign * (a.duration - b.duration);
      }
      case 'added':
        return sign * (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
    }
  };
  return [...tracks].sort((a, b) => compareValue(a, b) || collator.compare(a.title, b.title) || sign * (a.id - b.id));
}
