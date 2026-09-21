import { useEffect, useRef, useState } from 'react';
import { api, formatDuration } from '../api';
import { useI18n } from '../I18nProvider';
import { REPEAT_LABEL_KEY } from '../i18n';
import { usePlayer } from '../player/PlayerProvider';
import {
  IconChevronUp,
  IconMoon,
  IconPause,
  IconPlay,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeMute,
} from './Icons';
import { NowPlaying } from './NowPlaying';
import { SeekBar } from './SeekBar';

const SLEEP_OPTIONS = [15, 30, 45, 60] as const; // minutes

function SleepTimer() {
  const p = usePlayer();
  const { t } = useI18n();
  const endsAt = p.sleep?.kind === 'minutes' ? p.sleep.endsAt : null;
  const [now, setNow] = useState(Date.now);

  // Tick once a second only while a countdown is running.
  useEffect(() => {
    if (endsAt === null) return;
    // The first reading is scheduled, not set here, so a stale `now` from before the timer started lasts one tick.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [endsAt]);

  const remaining = endsAt === null ? null : formatDuration(Math.max(0, (endsAt - now) / 1000));

  return (
    <label className={`sleep ${p.sleep ? 'sleep--active' : ''}`} title={t('sleep.label')}>
      <span aria-hidden className="sleep__icon">
        <IconMoon size={16} />
      </span>
      <select
        className="select"
        aria-label={t('sleep.label')}
        value={p.sleep === null ? '' : p.sleep.kind === 'track' ? 'track' : 'minutes'}
        onChange={(e) => {
          const v = e.target.value;
          p.setSleep(v === '' ? null : v === 'track' ? 'track' : Number(v));
        }}
      >
        <option value="">{p.sleep ? t('sleep.off') : t('sleep.label')}</option>
        {SLEEP_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {t('sleep.minutes', { n: m })}
          </option>
        ))}
        <option value="track">{t('sleep.endOfTrack')}</option>
        {remaining !== null && (
          <option value="minutes" hidden>
            {t('sleep.left', { time: remaining })}
          </option>
        )}
      </select>
    </label>
  );
}

export function PlayerBar() {
  const p = usePlayer();
  const { t } = useI18n();
  const disabled = !p.current;
  const [expanded, setExpanded] = useState(false);
  // Track a swipe so a flick upwards opens the sheet, like YouTube Music.
  const swipeStart = useRef<number | null>(null);

  const open = () => {
    if (p.queue.length) setExpanded(true);
  };

  const cover = p.current ? api.coverUrl(p.current) : null;

  return (
    <>
      {expanded && <NowPlaying onClose={() => setExpanded(false)} />}
      <footer className="player">
        <div
          className={`player__now${p.queue.length ? ' player__now--opens' : ''}`}
          role={p.queue.length ? 'button' : undefined}
          tabIndex={p.queue.length ? 0 : undefined}
          aria-expanded={p.queue.length ? expanded : undefined}
          aria-label={p.current ? t('player.expand', { title: p.current.title }) : undefined}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }}
          onPointerDown={(e) => {
            swipeStart.current = e.clientY;
          }}
          onPointerMove={(e) => {
            if (swipeStart.current === null) return;
            if (swipeStart.current - e.clientY > 40) {
              swipeStart.current = null;
              open();
            }
          }}
          onPointerUp={() => {
            swipeStart.current = null;
          }}
        >
          {cover && <img className="player__cover" src={cover} alt="" />}
          {p.current ? (
            <>
              <div className="player__title" title={p.current.title}>
                {p.current.title}
              </div>
              <div className="player__artist">{p.current.artist || t('common.unknownArtist')}</div>
              <span className="player__expand" aria-hidden>
                <IconChevronUp size={16} />
              </span>
            </>
          ) : (
            <div className="player__artist">{t('player.nothingPlaying')}</div>
          )}
        </div>

        <div className="player__center">
          <div className="player__controls">
            <button className={`icon ${p.shuffle ? 'icon--active' : ''}`} onClick={p.toggleShuffle} title={t('player.shuffle')} aria-pressed={p.shuffle}>
              <IconShuffle size={18} />
            </button>
            <button className="icon" onClick={p.prev} disabled={disabled} title={t('player.previous')}>
              <IconSkipBack size={18} />
            </button>
            <button className="icon icon--big" onClick={p.toggle} disabled={disabled} title={p.playing ? t('player.pause') : t('player.play')}>
              {p.playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <button className="icon" onClick={p.next} disabled={disabled} title={t('player.next')}>
              <IconSkipForward size={18} />
            </button>
            <button
              className={`icon ${p.repeat !== 'off' ? 'icon--active' : ''}`}
              onClick={p.cycleRepeat}
              title={t('player.repeat', { mode: t(REPEAT_LABEL_KEY[p.repeat]) })}
            >
              {p.repeat === 'one' ? <IconRepeatOne size={18} /> : <IconRepeat size={18} />}
            </button>
          </div>
          <div className="player__seek">
            <SeekBar disabled={disabled} />
          </div>
        </div>

        <div className="player__volume">
          <SleepTimer />
          <button className="icon" onClick={p.toggleMute} title={t('player.mute')} aria-pressed={p.muted}>
            {p.muted || p.volume === 0 ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.muted ? 0 : p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
            aria-label={t('player.volume')}
          />
        </div>
      </footer>
    </>
  );
}
