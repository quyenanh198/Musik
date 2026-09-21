/* This file drives the browser's HTMLAudioElement (pause, currentTime, src, volume): an external, mutable object owned
   by the player, not React state. The "immutability" rule cannot tell those apart, so it is off here and nowhere else. */
/* eslint-disable react-hooks/immutability */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Track } from '../../shared/types';
import { api } from '../api';
import { normalizeVolume } from '../preferences';
import { readStored, removeStored, writeStored } from '../storage';
import { useLatest } from '../useLatest';
import { getAudioElement, getPreloadAudioElement, VOLUME_KEY } from './audio';
import { PLAYBACK_KEY, parseSavedPlayback, restorePlayback, serializePlayback } from './persistence';
import * as Q from './queueState';

export type { RepeatMode } from './queueState';
/** Pause at a wall-clock time, or after the current track ends. */
export type SleepTimer = { kind: 'minutes'; endsAt: number } | { kind: 'track' } | null;
/** The last track that failed to play; `nonce` changes every time so the same track failing twice is still news. */
export interface PlaybackError {
  title: string;
  nonce: number;
}

interface PlayerApi {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Q.RepeatMode;
  sleep: SleepTimer;
  playbackError: PlaybackError | null;
  /** Replace the queue and start at `startIndex`. */
  playQueue: (tracks: Track[], startIndex: number) => void;
  /** Turn shuffle on and play `tracks` in random order. */
  shufflePlay: (tracks: Track[]) => void;
  /** `minutes` > 0 pauses after that long, 'track' after the current track, null clears. */
  setSleep: (value: number | 'track' | null) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  /** Seek relative to where the track is now (negative = back). */
  seekBy: (delta: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Jump to a position in the queue and play it. */
  playAt: (index: number) => void;
  /** Reorder the queue; whatever is playing keeps playing. */
  moveInQueue: (from: number, to: number) => void;
  /** Drop one queue entry by position (the track stays in the library). */
  removeAt: (index: number) => void;
  /** Drop a deleted track from the queue. */
  removeTrack: (trackId: number) => void;
  /** Refresh a track's metadata in the queue after an edit. */
  updateTrack: (track: Track) => void;
  /** Bring back the queue and position saved before the last reload (once), paused. Call when the library has loaded. */
  restore: (library: Track[]) => void;
}

/** Playback position lives apart from the rest so its four-times-a-second updates only re-render what shows the clock. */
interface PlayerTime {
  currentTime: number;
  duration: number;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const PlayerTimeContext = createContext<PlayerTime>({ currentTime: 0, duration: 0 });

const SAVE_INTERVAL_MS = 5000;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = getAudioElement();

  const [q, setQ] = useState<Q.QueueState>(Q.emptyQueue);
  // Every queue change is computed from this ref and committed through `commit`, so back-to-back calls in one tick
  // (two quick key presses) build on each other instead of on a stale render.
  const qRef = useRef(q);
  const commit = useCallback((next: Q.QueueState) => {
    qRef.current = next;
    setQ(next);
  }, []);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState<PlayerTime>({ currentTime: 0, duration: 0 });
  const [volume, setVolumeState] = useState(() => audio.volume);
  const [muted, setMuted] = useState(false);
  const [sleep, setSleepState] = useState<SleepTimer>(null);
  const [playbackError, setPlaybackError] = useState<PlaybackError | null>(null);

  /** Whether the next load should start playing (false only when restoring a saved session). */
  const autoplayRef = useRef(true);
  const pendingSeekRef = useRef(0);
  /** Tracks that failed in a row; when every queued track has failed the player stops instead of cycling forever. */
  const failuresRef = useRef(0);
  const restoredRef = useRef(false);
  const persistOn = useRef(false);

  const current = q.index >= 0 ? (q.queue[q.index] ?? null) : null;

  const begin = useCallback(() => {
    autoplayRef.current = true;
    failuresRef.current = 0;
    persistOn.current = true;
  }, []);

  const halt = useCallback(() => {
    audio.pause();
    audio.removeAttribute('src');
    setPlaying(false);
    setTime({ currentTime: 0, duration: 0 });
  }, [audio]);

  const playQueue = useCallback(
    (tracks: Track[], startIndex: number) => {
      begin();
      commit(Q.startQueue(qRef.current, tracks, startIndex));
    },
    [begin, commit],
  );

  const shufflePlay = useCallback(
    (tracks: Track[]) => {
      begin();
      commit(Q.shuffleAll(qRef.current, tracks));
    },
    [begin, commit],
  );

  const next = useCallback(() => {
    const { state, stop } = Q.advance(qRef.current);
    if (stop) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      setTime((t) => ({ ...t, currentTime: 0 }));
      return;
    }
    autoplayRef.current = true;
    commit(state);
  }, [audio, commit]);

  const prev = useCallback(() => {
    if (qRef.current.queue.length === 0) return;
    // Standard behaviour: restart the track unless we're right at its start.
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const back = Q.previous(qRef.current);
    if (!back) {
      audio.currentTime = 0;
      return;
    }
    autoplayRef.current = true;
    commit(back);
  }, [audio, commit]);

  const playAt = useCallback(
    (index: number) => {
      begin();
      commit(Q.jumpTo(qRef.current, index));
    },
    [begin, commit],
  );

  const toggle = useCallback(() => {
    if (qRef.current.index < 0) return;
    if (audio.paused) {
      void audio.play().catch((e: DOMException) => {
        if (e.name !== 'AbortError') setPlaying(false);
      });
    } else audio.pause();
  }, [audio]);

  const seek = useCallback(
    (seconds: number) => {
      const limit = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      const target = Math.max(0, Math.min(seconds, limit));
      audio.currentTime = target;
      setTime((t) => ({ ...t, currentTime: target }));
    },
    [audio],
  );

  const seekBy = useCallback((delta: number) => seek(audio.currentTime + delta), [audio, seek]);

  const setVolume = useCallback(
    (next: number) => {
      const safe = normalizeVolume(next);
      audio.volume = safe;
      audio.muted = false;
      setMuted(false);
      writeStored(VOLUME_KEY, String(safe));
      setVolumeState(safe);
    },
    [audio],
  );

  const toggleMute = useCallback(() => {
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, [audio]);

  const setSleep = useCallback((value: number | 'track' | null) => {
    setSleepState(value === null ? null : value === 'track' ? { kind: 'track' } : { kind: 'minutes', endsAt: Date.now() + value * 60_000 });
  }, []);

  const toggleShuffle = useCallback(() => commit(Q.setShuffle(qRef.current, !qRef.current.shuffle)), [commit]);
  const cycleRepeat = useCallback(() => commit(Q.cycleRepeat(qRef.current)), [commit]);
  const moveInQueue = useCallback((from: number, to: number) => commit(Q.reorder(qRef.current, from, to)), [commit]);
  const updateTrack = useCallback((track: Track) => commit(Q.updateTrack(qRef.current, track)), [commit]);

  const removeAt = useCallback(
    (index: number) => {
      const { state, removedCurrent } = Q.dropAt(qRef.current, index);
      if (state === qRef.current) return;
      commit(state);
      if (removedCurrent) halt();
    },
    [commit, halt],
  );

  const removeTrack = useCallback(
    (trackId: number) => {
      const { state, removedCurrent } = Q.dropTrack(qRef.current, trackId);
      if (state === qRef.current) return;
      commit(state);
      if (removedCurrent) halt();
    },
    [commit, halt],
  );

  const restore = useCallback(
    (library: Track[]) => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      if (qRef.current.queue.length === 0) {
        const saved = parseSavedPlayback(readStored(PLAYBACK_KEY));
        const restored = saved ? restorePlayback(saved, library) : null;
        if (restored) {
          autoplayRef.current = false;
          pendingSeekRef.current = restored.position;
          commit({ ...restored.state, token: qRef.current.token + 1 });
        }
      }
      persistOn.current = true;
    },
    [commit],
  );

  // Load the current track whenever playback of it has to (re)start: a different track, or the same one again.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId === null) return;
    audio.src = api.streamUrl(currentId);
    const seekTo = pendingSeekRef.current;
    pendingSeekRef.current = 0;
    if (seekTo > 0) {
      audio.addEventListener(
        'loadedmetadata',
        () => {
          audio.currentTime = seekTo;
          setTime((t) => ({ ...t, currentTime: seekTo }));
        },
        { once: true },
      );
    }
    if (autoplayRef.current) {
      // A newer load interrupting this one rejects with AbortError; that is not "stopped".
      void audio.play().catch((e: DOMException) => {
        if (e.name !== 'AbortError') setPlaying(false);
      });
    }
    autoplayRef.current = true;

    // Pre-buffer the next track in the queue using the dedicated preload element
    const nextIndex = q.index + 1;
    const nextTrack = nextIndex < q.queue.length ? q.queue[nextIndex] : q.repeat === 'all' && q.queue.length > 0 ? q.queue[0] : null;
    if (nextTrack) {
      const preloader = getPreloadAudioElement();
      preloader.src = api.streamUrl(nextTrack.id);
    }
  }, [audio, currentId, q.token, q.index, q.queue, q.repeat]);

  // The 'track' sleep timer is read from a ref so the ended handler does not need re-binding when it changes.
  const sleepRef = useLatest(sleep);

  // Mirror audio element events into state.
  useEffect(() => {
    const onTime = () => setTime((t) => ({ ...t, currentTime: audio.currentTime }));
    const onDuration = () => setTime((t) => ({ ...t, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onPlaying = () => {
      failuresRef.current = 0;
    };
    const onEnded = () => {
      if (sleepRef.current?.kind === 'track') {
        setPlaying(false);
        setSleepState(null);
        return;
      }
      if (qRef.current.repeat === 'one') {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      } else next();
    };
    const onError = () => {
      // Clearing the source (a removed track) is not a failure.
      if (!audio.getAttribute('src') || !audio.error) return;
      const failed = qRef.current.queue[qRef.current.index];
      setPlaybackError({ title: failed?.title ?? '', nonce: Date.now() });
      failuresRef.current += 1;
      if (failuresRef.current >= qRef.current.queue.length) {
        setPlaying(false);
        return;
      }
      next();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [audio, next, sleepRef]);

  // Sleep timer: pause when the deadline passes.
  const sleepEndsAt = sleep?.kind === 'minutes' ? sleep.endsAt : null;
  useEffect(() => {
    if (sleepEndsAt === null) return;
    const id = window.setTimeout(() => {
      audio.pause();
      setSleepState(null);
    }, Math.max(0, sleepEndsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [audio, sleepEndsAt]);

  // Media Session: lock-screen / headset / OS media controls while in the background.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => void audio.play().catch(() => {}));
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime != null) seek(d.seekTime);
    });
    // No seekbackward/seekforward: iOS then shows ±10s buttons *instead of* previous/next.
    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const) ms.setActionHandler(action, null);
    };
  }, [audio, next, prev, seek]);

  // Lock-screen metadata. iOS only picks it up once its Now Playing session exists (i.e. after
  // playback actually starts) and ignores SVG artwork, so re-apply on every `playing` with PNGs.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const apply = () => {
      const cover = current ? api.coverUrl(current) : null;
      navigator.mediaSession.metadata = current
        ? new MediaMetadata({
            title: current.title,
            artist: current.artist || 'Musik',
            album: current.album,
            artwork: cover
              ? [{ src: `${location.origin}${cover}`, sizes: '512x512' }]
              : [
                  { src: `${location.origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
                  { src: `${location.origin}/icon-512.png`, sizes: '512x512', type: 'image/png' },
                ],
          })
        : null;
    };
    apply();
    audio.addEventListener('playing', apply);
    audio.addEventListener('loadedmetadata', apply);
    return () => {
      audio.removeEventListener('playing', apply);
      audio.removeEventListener('loadedmetadata', apply);
    };
  }, [audio, current]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none';
  }, [current, playing]);

  // The OS extrapolates the position from a starting point, so it only needs telling when playback jumps or changes
  // state, not on every tick.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const sync = () => {
      const duration = audio.duration;
      if (!current || !Number.isFinite(duration) || duration <= 0) return;
      try {
        navigator.mediaSession.setPositionState({ duration, position: Math.min(audio.currentTime, duration), playbackRate: audio.playbackRate || 1 });
      } catch {
        // Some browsers throw on transiently inconsistent values.
      }
    };
    sync();
    const events = ['playing', 'pause', 'seeked', 'durationchange', 'ratechange'] as const;
    events.forEach((name) => audio.addEventListener(name, sync));
    return () => events.forEach((name) => audio.removeEventListener(name, sync));
  }, [audio, current]);

  // Remember the queue and position so a reload (or a phone reclaiming the tab) picks up where it left off.
  const persist = useCallback(() => {
    if (!persistOn.current) return;
    if (qRef.current.queue.length === 0) removeStored(PLAYBACK_KEY);
    else writeStored(PLAYBACK_KEY, JSON.stringify(serializePlayback(qRef.current, audio.currentTime)));
  }, [audio]);

  useEffect(() => {
    const id = window.setTimeout(persist, 400);
    return () => window.clearTimeout(id);
  }, [q.queue, q.index, q.shuffle, q.repeat, persist]);

  useEffect(() => {
    if (!playing) {
      persist();
      return;
    }
    const id = window.setInterval(persist, SAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, persist]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [persist]);

  const value = useMemo<PlayerApi>(
    () => ({
      queue: q.queue,
      index: q.index,
      current,
      playing,
      volume,
      muted,
      shuffle: q.shuffle,
      repeat: q.repeat,
      sleep,
      playbackError,
      playQueue,
      shufflePlay,
      setSleep,
      toggle,
      next,
      prev,
      seek,
      seekBy,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      playAt,
      moveInQueue,
      removeAt,
      removeTrack,
      updateTrack,
      restore,
    }),
    [
      q.queue,
      q.index,
      q.shuffle,
      q.repeat,
      current,
      playing,
      volume,
      muted,
      sleep,
      playbackError,
      playQueue,
      shufflePlay,
      setSleep,
      toggle,
      next,
      prev,
      seek,
      seekBy,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      playAt,
      moveInQueue,
      removeAt,
      removeTrack,
      updateTrack,
      restore,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={time}>{children}</PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
}

/** Everything about the player except the moving clock; re-renders only when something the user can see changes. */
export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}

/** Position and length of the current track; updates several times a second, so use it only where the clock is shown. */
export function usePlayerTime(): PlayerTime {
  return useContext(PlayerTimeContext);
}
