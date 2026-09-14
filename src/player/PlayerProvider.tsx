import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Track } from '../../shared/types';
import { api } from '../api';

export type RepeatMode = 'off' | 'all' | 'one';
/** Pause at a wall-clock time, or after the current track ends. */
export type SleepTimer = { kind: 'minutes'; endsAt: number } | { kind: 'track' } | null;

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  sleep: SleepTimer;
}

interface PlayerApi extends PlayerState {
  current: Track | null;
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
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Drop a deleted track from the queue. */
  removeTrack: (trackId: number) => void;
  /** Refresh a track's metadata in the queue after an edit. */
  updateTrack: (track: Track) => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

const VOLUME_KEY = 'musik:volume';

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }
  const audio = audioRef.current;

  const [state, setState] = useState<PlayerState>(() => ({
    queue: [],
    index: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: Number(localStorage.getItem(VOLUME_KEY) ?? 1),
    shuffle: false,
    repeat: 'off',
    sleep: null,
  }));
  // Event handlers (audio events, Media Session) need the latest state without re-binding.
  const stateRef = useRef(state);
  stateRef.current = state;

  const current = state.index >= 0 ? (state.queue[state.index] ?? null) : null;

  const goTo = useCallback(
    (index: number) => {
      setState((s) => ({ ...s, index, currentTime: 0, playing: true }));
    },
    [],
  );

  const next = useCallback(() => {
    const { queue, index, repeat } = stateRef.current;
    if (queue.length === 0) return;
    if (index + 1 < queue.length) goTo(index + 1);
    else if (repeat === 'all') goTo(0);
    else {
      audio.pause();
      audio.currentTime = 0;
      setState((s) => ({ ...s, playing: false, currentTime: 0 }));
    }
  }, [audio, goTo]);

  const prev = useCallback(() => {
    const { queue, index } = stateRef.current;
    if (queue.length === 0) return;
    // Standard behaviour: restart the track unless we're right at its start.
    if (audio.currentTime > 3 || index === 0) {
      audio.currentTime = 0;
      return;
    }
    goTo(index - 1);
  }, [audio, goTo]);

  const toggle = useCallback(() => {
    if (!stateRef.current.queue.length) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, [audio]);

  const seek = useCallback(
    (seconds: number) => {
      audio.currentTime = seconds;
      setState((s) => ({ ...s, currentTime: seconds }));
    },
    [audio],
  );

  const setVolume = useCallback(
    (volume: number) => {
      audio.volume = volume;
      localStorage.setItem(VOLUME_KEY, String(volume));
      setState((s) => ({ ...s, volume }));
    },
    [audio],
  );

  const playQueue = useCallback((tracks: Track[], startIndex: number) => {
    setState((s) => {
      if (!s.shuffle) return { ...s, queue: tracks, index: startIndex, currentTime: 0, playing: true };
      const first = tracks[startIndex];
      const rest = shuffled(tracks.filter((_, i) => i !== startIndex));
      return { ...s, queue: [first, ...rest], index: 0, currentTime: 0, playing: true };
    });
  }, []);

  const shufflePlay = useCallback((tracks: Track[]) => {
    if (tracks.length === 0) return;
    setState((s) => ({ ...s, shuffle: true, queue: shuffled(tracks), index: 0, currentTime: 0, playing: true }));
  }, []);

  const setSleep = useCallback((value: number | 'track' | null) => {
    setState((s) => ({
      ...s,
      sleep: value === null ? null : value === 'track' ? { kind: 'track' } : { kind: 'minutes', endsAt: Date.now() + value * 60_000 },
    }));
  }, []);

  const toggleShuffle = useCallback(() => {
    setState((s) => {
      const shuffle = !s.shuffle;
      if (!shuffle || s.index < 0) return { ...s, shuffle };
      // Keep the playing track first, shuffle the rest.
      const cur = s.queue[s.index];
      return { ...s, shuffle, queue: [cur, ...shuffled(s.queue.filter((_, i) => i !== s.index))], index: 0 };
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setState((s) => ({ ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }));
  }, []);

  const removeTrack = useCallback(
    (trackId: number) => {
      setState((s) => {
        const removedIndex = s.queue.findIndex((t) => t.id === trackId);
        if (removedIndex === -1) return s;
        const queue = s.queue.filter((t) => t.id !== trackId);
        if (removedIndex === s.index) {
          audio.pause();
          audio.removeAttribute('src');
          return { ...s, queue, index: -1, playing: false, currentTime: 0, duration: 0 };
        }
        return { ...s, queue, index: removedIndex < s.index ? s.index - 1 : s.index };
      });
    },
    [audio],
  );

  const updateTrack = useCallback((track: Track) => {
    setState((s) => ({ ...s, queue: s.queue.map((t) => (t.id === track.id ? track : t)) }));
  }, []);

  // Load + play whenever the current track changes.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId === null) return;
    audio.src = api.streamUrl(currentId);
    audio.volume = stateRef.current.volume;
    void audio.play().catch(() => setState((s) => ({ ...s, playing: false })));
  }, [audio, currentId]);

  // Mirror audio element events into state.
  useEffect(() => {
    const onTime = () => setState((s) => ({ ...s, currentTime: audio.currentTime }));
    const onDuration = () => setState((s) => ({ ...s, duration: audio.duration || 0 }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onEnded = () => {
      if (stateRef.current.sleep?.kind === 'track') {
        setState((s) => ({ ...s, playing: false, sleep: null }));
        return;
      }
      if (stateRef.current.repeat === 'one') {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      } else next();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audio, next]);

  // Sleep timer: pause when the deadline passes.
  const sleepEndsAt = state.sleep?.kind === 'minutes' ? state.sleep.endsAt : null;
  useEffect(() => {
    if (sleepEndsAt === null) return;
    const id = window.setTimeout(() => {
      audio.pause();
      setState((s) => ({ ...s, sleep: null }));
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
    ms.setActionHandler('seekbackward', (d) => seek(Math.max(0, audio.currentTime - (d.seekOffset ?? 10))));
    ms.setActionHandler('seekforward', (d) =>
      seek(Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset ?? 10))),
    );
    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'] as const)
        ms.setActionHandler(action, null);
    };
  }, [audio, next, prev, seek]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist,
          album: current.album,
          artwork: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
        })
      : null;
  }, [current]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = current ? (state.playing ? 'playing' : 'paused') : 'none';
    if (current && Number.isFinite(state.duration) && state.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          position: Math.min(state.currentTime, state.duration),
          playbackRate: 1,
        });
      } catch {
        // Some browsers throw on transiently inconsistent values.
      }
    }
  }, [current, state.playing, state.currentTime, state.duration]);

  const value = useMemo<PlayerApi>(
    () => ({
      ...state,
      current,
      playQueue,
      shufflePlay,
      setSleep,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      removeTrack,
      updateTrack,
    }),
    [
      state,
      current,
      playQueue,
      shufflePlay,
      setSleep,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      removeTrack,
      updateTrack,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
