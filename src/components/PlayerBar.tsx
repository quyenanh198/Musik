import { useEffect, useState } from 'react';
import { formatDuration } from '../api';
import { usePlayer } from '../player/PlayerProvider';

const SLEEP_OPTIONS = [15, 30, 45, 60] as const;

function SleepTimer() {
  const p = usePlayer();
  const endsAt = p.sleep?.kind === 'minutes' ? p.sleep.endsAt : null;
  const [now, setNow] = useState(Date.now);

  // Tick once a second only while a countdown is running.
  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const remaining = endsAt === null ? null : formatDuration(Math.max(0, (endsAt - now) / 1000));

  return (
    <label className={`sleep ${p.sleep ? 'sleep--active' : ''}`} title="Sleep timer">
      <span aria-hidden>⏾</span>
      <select
        className="select"
        aria-label="Sleep timer"
        value={p.sleep === null ? '' : p.sleep.kind === 'track' ? 'track' : 'minutes'}
        onChange={(e) => {
          const v = e.target.value;
          p.setSleep(v === '' ? null : v === 'track' ? 'track' : Number(v));
        }}
      >
        <option value="">{p.sleep ? 'Off' : 'Sleep'}</option>
        {SLEEP_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} min
          </option>
        ))}
        <option value="track">End of track</option>
        {remaining !== null && (
          <option value="minutes" hidden>
            {remaining} left
          </option>
        )}
      </select>
    </label>
  );
}

export function PlayerBar() {
  const p = usePlayer();
  const disabled = !p.current;

  return (
    <footer className="player">
      <div className="player__now">
        {p.current ? (
          <>
            <div className="player__title" title={p.current.title}>
              {p.current.title}
            </div>
            <div className="player__artist">{p.current.artist || 'Unknown artist'}</div>
          </>
        ) : (
          <div className="player__artist">Nothing playing</div>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <button
            className={`icon ${p.shuffle ? 'icon--active' : ''}`}
            onClick={p.toggleShuffle}
            title="Shuffle"
            aria-pressed={p.shuffle}
          >
            ⇄
          </button>
          <button className="icon" onClick={p.prev} disabled={disabled} title="Previous">
            ⏮
          </button>
          <button className="icon icon--big" onClick={p.toggle} disabled={disabled} title={p.playing ? 'Pause' : 'Play'}>
            {p.playing ? '⏸' : '▶'}
          </button>
          <button className="icon" onClick={p.next} disabled={disabled} title="Next">
            ⏭
          </button>
          <button
            className={`icon ${p.repeat !== 'off' ? 'icon--active' : ''}`}
            onClick={p.cycleRepeat}
            title={`Repeat: ${p.repeat}`}
          >
            {p.repeat === 'one' ? '↻¹' : '↻'}
          </button>
        </div>
        <div className="player__seek">
          <span className="mono">{formatDuration(p.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={p.duration || 0}
            step={0.5}
            value={Math.min(p.currentTime, p.duration || 0)}
            disabled={disabled || !p.duration}
            onChange={(e) => p.seek(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className="mono">{formatDuration(p.duration)}</span>
        </div>
      </div>

      <div className="player__volume">
        <SleepTimer />
        <span aria-hidden>🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>
    </footer>
  );
}
