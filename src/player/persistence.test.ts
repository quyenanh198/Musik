import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types';
import { parseSavedPlayback, restorePlayback, serializePlayback } from './persistence';
import { emptyQueue, startQueue } from './queueState';

const track = (id: number): Track => ({
  id,
  title: `T${id}`,
  artist: '',
  album: '',
  year: null,
  genre: '',
  cover: null,
  sourceApp: null,
  duration: 1,
  mimeType: 'audio/wav',
  size: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const library = [1, 2, 3, 4].map(track);

describe('saving and reading playback state', () => {
  it('round-trips the queue, position and modes', () => {
    const state = { ...startQueue(emptyQueue, library, 2), repeat: 'all' as const, shuffle: true };
    const saved = parseSavedPlayback(JSON.stringify(serializePlayback(state, 83.7)));
    expect(saved).toEqual({ ids: [1, 2, 3, 4], index: 2, position: 83, shuffle: true, repeat: 'all' });
  });

  it.each([
    ['nothing saved', null],
    ['not JSON', '{oops'],
    ['not an object', '42'],
    ['an empty queue', '{"ids":[]}'],
    ['ids that are not ids', '{"ids":[1,"2"]}'],
    ['a negative id', '{"ids":[-1]}'],
  ])('ignores %s', (_label, raw) => {
    expect(parseSavedPlayback(raw)).toBeNull();
  });

  it('falls back to safe defaults for bad optional fields', () => {
    expect(parseSavedPlayback('{"ids":[1],"repeat":"sideways","index":"x","position":-5}')).toEqual({
      ids: [1],
      index: -1,
      position: 0,
      shuffle: false,
      repeat: 'off',
    });
  });
});

describe('restoring into the current library', () => {
  const saved = { ids: [4, 2, 9, 1], index: 3, position: 40, shuffle: false, repeat: 'one' as const };

  it('drops tracks that were deleted since and finds the one that was playing', () => {
    const restored = restorePlayback(saved, library);
    expect(restored?.state.queue.map((t) => t.id)).toEqual([4, 2, 1]);
    expect(restored?.state.index).toBe(2);
    expect(restored?.position).toBe(40);
    expect(restored?.state.repeat).toBe('one');
  });

  it('keeps the queue but restarts from the top when the playing track is gone', () => {
    const restored = restorePlayback({ ...saved, index: 2 }, library); // id 9 was playing
    expect(restored?.state.queue.map((t) => t.id)).toEqual([4, 2, 1]);
    expect(restored?.position).toBe(0);
    expect(restored?.state.index).toBeGreaterThanOrEqual(0);
  });

  it('gives nothing back when none of the tracks exist any more', () => {
    expect(restorePlayback({ ...saved, ids: [50, 60], index: 0 }, library)).toBeNull();
  });
});
