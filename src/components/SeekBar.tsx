import { formatDuration } from '../api';
import { useI18n } from '../I18nProvider';
import { usePlayer, usePlayerTime } from '../player/PlayerProvider';

/** The clock and seek slider: the only part of the player that re-renders as the song plays. */
export function SeekBar({ disabled }: { disabled?: boolean }) {
  const p = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const { t } = useI18n();
  return (
    <>
      <span className="mono">{formatDuration(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.5}
        value={Math.min(currentTime, duration || 0)}
        disabled={disabled || !p.current || !duration}
        onChange={(e) => p.seek(Number(e.target.value))}
        aria-label={t('player.seek')}
      />
      <span className="mono">{formatDuration(duration)}</span>
    </>
  );
}
