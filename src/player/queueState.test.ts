import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types';
import {
  advance,
  cycleRepeat,
  dropAt,
  dropTrack,
  emptyQueue,
  jumpTo,
  previous,
  reorder,
  setShuffle,
  shuffleAll,
  startQueue,
  updateTrack,
  type QueueState,
} from './queueState';

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
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i + 1));
const ids = (s: QueueState) => s.queue.map((t) => t.id);
/** A "random" that always picks the last candidate, so shuffles are reproducible. */
const last = () => 0.999;

describe('startQueue', () => {
  it('loads the tracks and starts where asked', () => {
    const s = startQueue(emptyQueue, tracks(4), 2);
    expect(ids(s)).toEqual([1, 2, 3, 4]);
    expect(s.index).toBe(2);
    expect(s.token).toBe(1);
  });

  it('bumps the token even for the track that is already playing, so it restarts (clicking it again works)', () => {
    const first = startQueue(emptyQueue, tracks(3), 1);
    const again = startQueue(first, tracks(3), 1);
    expect(again.index).toBe(first.index);
    expect(again.token).toBeGreaterThan(first.token);
  });

  it('with shuffle on still plays the chosen track first and keeps every track', () => {
    const s = startQueue({ ...emptyQueue, shuffle: true }, tracks(5), 3, last);
    expect(s.queue[0].id).toBe(4);
    expect(s.index).toBe(0);
    expect([...ids(s)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores a start index outside the list', () => {
    expect(startQueue(emptyQueue, tracks(2), 5)).toBe(emptyQueue);
  });
});

describe('shuffleAll / jumpTo', () => {
  it('shuffles and turns shuffle on; an empty list changes nothing', () => {
    const s = shuffleAll(emptyQueue, tracks(4), last);
    expect(s.shuffle).toBe(true);
    expect([...ids(s)].sort()).toEqual([1, 2, 3, 4]);
    expect(shuffleAll(emptyQueue, [])).toBe(emptyQueue);
  });

  it('jumps only inside the queue', () => {
    const s = startQueue(emptyQueue, tracks(3), 0);
    expect(jumpTo(s, 2).index).toBe(2);
    expect(jumpTo(s, 3)).toBe(s);
    expect(jumpTo(s, -1)).toBe(s);
  });
});

describe('advance', () => {
  it('moves to the next track', () => {
    const { state, stop } = advance(startQueue(emptyQueue, tracks(3), 0));
    expect(state.index).toBe(1);
    expect(stop).toBe(false);
  });

  it('stops at the end of the queue without losing it', () => {
    const s = startQueue(emptyQueue, tracks(2), 1);
    const result = advance(s);
    expect(result.stop).toBe(true);
    expect(result.state).toBe(s);
  });

  it('repeat-all wraps to the top with a fresh token', () => {
    const s = { ...startQueue(emptyQueue, tracks(2), 1), repeat: 'all' as const };
    const { state } = advance(s);
    expect(state.index).toBe(0);
    expect(state.token).toBeGreaterThan(s.token);
  });

  it('repeat-all on a one-track queue restarts that track instead of stopping', () => {
    const s = { ...startQueue(emptyQueue, tracks(1), 0), repeat: 'all' as const };
    const { state, stop } = advance(s);
    expect(stop).toBe(false);
    expect(state.index).toBe(0);
    expect(state.token).toBeGreaterThan(s.token); // same track, but the loader must run again
  });

  it('does nothing on an empty queue', () => {
    expect(advance(emptyQueue)).toEqual({ state: emptyQueue, stop: false });
  });
});

describe('previous', () => {
  it('goes back one, and reports null at the first track so the caller restarts it', () => {
    const s = startQueue(emptyQueue, tracks(3), 2);
    expect(previous(s)?.index).toBe(1);
    expect(previous(startQueue(emptyQueue, tracks(3), 0))).toBeNull();
  });
});

describe('dropAt / dropTrack', () => {
  const playing = () => startQueue(emptyQueue, tracks(5), 2); // T3 is playing

  it('keeps following the playing track when an earlier row goes', () => {
    const { state, removedCurrent } = dropAt(playing(), 0);
    expect(ids(state)).toEqual([2, 3, 4, 5]);
    expect(state.index).toBe(1);
    expect(state.queue[state.index].id).toBe(3);
    expect(removedCurrent).toBe(false);
  });

  it('leaves the index alone when a later row goes', () => {
    const { state } = dropAt(playing(), 4);
    expect(state.index).toBe(2);
  });

  it('stops (index -1) rather than jumping when the playing row is dropped', () => {
    const { state, removedCurrent } = dropAt(playing(), 2);
    expect(state.index).toBe(-1);
    expect(removedCurrent).toBe(true);
    expect(ids(state)).toEqual([1, 2, 4, 5]);
  });

  it('ignores a position that does not exist', () => {
    const s = playing();
    expect(dropAt(s, 9).state).toBe(s);
  });

  it('drops a deleted track by id, wherever it is, including twice', () => {
    const s = startQueue(emptyQueue, [track(1), track(2), track(1), track(3)], 3); // T3 playing at index 3
    const { state, removedCurrent } = dropTrack(s, 1);
    expect(ids(state)).toEqual([2, 3]);
    expect(state.queue[state.index].id).toBe(3);
    expect(removedCurrent).toBe(false);
    expect(dropTrack(s, 3).removedCurrent).toBe(true);
    expect(dropTrack(s, 99).state).toBe(s);
  });
});

describe('reorder', () => {
  it('keeps the playing track playing for every possible move', () => {
    for (let playingAt = 0; playingAt < 5; playingAt++) {
      for (let from = 0; from < 5; from++) {
        for (let to = 0; to < 5; to++) {
          const s = startQueue(emptyQueue, tracks(5), playingAt);
          const moved = reorder(s, from, to);
          expect(moved.queue[moved.index].id, `playing ${playingAt}, ${from} -> ${to}`).toBe(playingAt + 1);
        }
      }
    }
  });

  it('is a no-op for the same slot or a bad source', () => {
    const s = startQueue(emptyQueue, tracks(3), 1);
    expect(reorder(s, 1, 1)).toBe(s);
    expect(reorder(s, 7, 0)).toBe(s);
  });

  it('forgets the pre-shuffle order once the user orders by hand', () => {
    const shuffled = setShuffle(startQueue(emptyQueue, tracks(4), 0), true, last);
    expect(shuffled.original).not.toBeNull();
    expect(reorder(shuffled, 0, 2).original).toBeNull();
  });
});

describe('setShuffle', () => {
  it('turning it on keeps the playing track first; turning it off restores the earlier order around it', () => {
    const s = startQueue(emptyQueue, tracks(5), 2); // T3 playing
    const on = setShuffle(s, true, last);
    expect(on.queue[0].id).toBe(3);
    expect(on.index).toBe(0);
    expect(on.token).toBe(s.token); // the track keeps playing; nothing reloads
    const off = setShuffle(on, false);
    expect(ids(off)).toEqual([1, 2, 3, 4, 5]);
    expect(off.queue[off.index].id).toBe(3);
  });

  it('turning it off after tracks left the queue restores the order of what remains', () => {
    const on = setShuffle(startQueue(emptyQueue, tracks(5), 0), true, last);
    const trimmed = dropTrack(on, 4).state;
    const off = setShuffle(trimmed, false);
    expect(ids(off)).toEqual([1, 2, 3, 5]);
  });

  it('is idempotent', () => {
    const s = startQueue(emptyQueue, tracks(2), 0);
    expect(setShuffle(s, false)).toBe(s);
  });
});

describe('repeat and metadata', () => {
  it('cycles off, all, one, off', () => {
    const modes = [emptyQueue.repeat];
    let s = emptyQueue;
    for (let i = 0; i < 3; i++) {
      s = cycleRepeat(s);
      modes.push(s.repeat);
    }
    expect(modes).toEqual(['off', 'all', 'one', 'off']);
  });

  it('refreshes an edited track in the queue', () => {
    const s = startQueue(emptyQueue, tracks(3), 0);
    const edited = updateTrack(s, { ...track(2), title: 'Renamed' });
    expect(edited.queue[1].title).toBe('Renamed');
    expect(edited.queue[0].title).toBe('T1');
  });
});
