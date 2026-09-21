import { describe, expect, it } from 'vitest';
import type { Track } from '../shared/types';
import { DEFAULT_SORT, defaultDirection, parseSort, sortTracks, type SortState } from './sort';

const track = (id: number, patch: Partial<Track> = {}): Track => ({
  id,
  title: `T${id}`,
  artist: '',
  album: '',
  year: null,
  genre: '',
  cover: null,
  sourceApp: null,
  duration: 100,
  mimeType: 'audio/wav',
  size: 1,
  createdAt: `2026-01-0${id}T00:00:00.000Z`,
  ...patch,
});
const order = (tracks: Track[], sort: SortState) => sortTracks(tracks, sort).map((t) => t.id);

describe('sortTracks', () => {
  it('newest first is the default and matches what the server sends', () => {
    expect(order([track(3), track(2), track(1)], DEFAULT_SORT)).toEqual([3, 2, 1]);
    expect(order([track(1), track(2), track(3)], { key: 'added', direction: 'asc' })).toEqual([1, 2, 3]);
  });

  it('sorts titles ignoring case and accents, with numbers by value', () => {
    const list = [track(1, { title: 'Zebra' }), track(2, { title: 'Ánh trăng' }), track(3, { title: 'Track 10' }), track(4, { title: 'track 2' })];
    expect(order(list, { key: 'title', direction: 'asc' })).toEqual([2, 4, 3, 1]);
    expect(order(list, { key: 'title', direction: 'desc' })).toEqual([1, 3, 4, 2]);
  });

  it('always puts tracks with no value last, in either direction', () => {
    const list = [track(1, { artist: '' }), track(2, { artist: 'B' }), track(3, { artist: 'A' })];
    expect(order(list, { key: 'artist', direction: 'asc' })).toEqual([3, 2, 1]);
    expect(order(list, { key: 'artist', direction: 'desc' })).toEqual([2, 3, 1]);
    const years = [track(1, { year: null }), track(2, { year: 1999 }), track(3, { year: 2020 })];
    expect(order(years, { key: 'year', direction: 'asc' })).toEqual([2, 3, 1]);
    expect(order(years, { key: 'year', direction: 'desc' })).toEqual([3, 2, 1]);
    const durations = [track(1, { duration: 0 }), track(2, { duration: 30 }), track(3, { duration: 90 })];
    expect(order(durations, { key: 'duration', direction: 'desc' })).toEqual([3, 2, 1]);
  });

  it('breaks ties by title so the order is stable', () => {
    const list = [track(1, { album: 'X', title: 'b' }), track(2, { album: 'X', title: 'a' })];
    expect(order(list, { key: 'album', direction: 'asc' })).toEqual([2, 1]);
  });

  it('does not change the list it was given', () => {
    const list = [track(1), track(2)];
    sortTracks(list, { key: 'title', direction: 'desc' });
    expect(list.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe('defaultDirection', () => {
  it('starts text fields at A to Z and the rest biggest or newest first', () => {
    expect(defaultDirection('title')).toBe('asc');
    expect(defaultDirection('artist')).toBe('asc');
    expect(defaultDirection('album')).toBe('asc');
    expect(defaultDirection('added')).toBe('desc');
    expect(defaultDirection('year')).toBe('desc');
    expect(defaultDirection('duration')).toBe('desc');
  });
});

describe('parseSort', () => {
  it('reads what was saved and rejects anything else', () => {
    expect(parseSort('{"key":"artist","direction":"asc"}')).toEqual({ key: 'artist', direction: 'asc' });
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort('{"key":"nope","direction":"asc"}')).toEqual(DEFAULT_SORT);
    expect(parseSort('{"key":"title","direction":"sideways"}')).toEqual(DEFAULT_SORT);
    expect(parseSort('not json')).toEqual(DEFAULT_SORT);
  });
});
