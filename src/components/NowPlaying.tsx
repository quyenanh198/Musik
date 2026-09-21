import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDuration } from '../api';
import { useI18n } from '../I18nProvider';
import { REPEAT_LABEL_KEY } from '../i18n';
import { usePlayer } from '../player/PlayerProvider';
import { dropIndex, shiftFor } from '../queueOrder'; // pure drag maths
import { useDialogFocus } from '../useDialogFocus';
import { useLatest } from '../useLatest';
import { SeekBar } from './SeekBar';

interface Drag {
  from: number;
  to: number;
  dy: number;
  rowStep: number;
}

/**
 * The expanded player: artwork, transport and the queue, opened from the player bar.
 * Queue rows are reordered by dragging their handle with a pointer (mouse or finger)
 * or, with the handle focused, the arrow keys.
 */
export function NowPlaying({ onClose }: { onClose: () => void }) {
  const p = usePlayer();
  const { t } = useI18n();
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLOListElement>(null);

  // The drag lives in a ref as well as in state: the pointer handlers read the latest value from the ref, and the
  // move is applied once, outside any state updater (an updater that called into the player ran twice under StrictMode).
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dragListeners = useRef<AbortController | null>(null);
  const queueLength = useLatest(p.queue.length);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  useEffect(() => () => dragListeners.current?.abort(), []);

  // Swipe the sheet down to dismiss, the way the bar swipes up to open it.
  const [sheetDy, setSheetDy] = useState(0);
  const swipe = useRef<{ y: number } | null>(null);

  // The sheet covers the app while open; don't let the page behind it scroll too.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /** Distance between two queue rows, measured rather than assumed. */
  const rowStepOf = useCallback((index: number) => {
    const rows = listRef.current?.children;
    const row = rows?.[index] as HTMLElement | undefined;
    if (!row) return 0;
    const nextRow = (rows?.[index + 1] ?? rows?.[index - 1]) as HTMLElement | undefined;
    if (!nextRow) return row.getBoundingClientRect().height;
    return Math.abs(nextRow.getBoundingClientRect().top - row.getBoundingClientRect().top);
  }, []);

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const startY = e.clientY;
    setDrag({ from: index, to: index, dy: 0, rowStep: rowStepOf(index) });

    dragListeners.current?.abort();
    const controller = new AbortController();
    dragListeners.current = controller;
    const finish = (applyMove: boolean) => {
      controller.abort();
      const d = dragRef.current;
      setDrag(null);
      if (applyMove && d && d.to !== d.from) p.moveInQueue(d.from, d.to);
    };
    window.addEventListener(
      'pointermove',
      (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const dy = ev.clientY - startY;
        setDrag({ ...d, dy, to: dropIndex(d.from, dy, d.rowStep, queueLength.current) });
      },
      { signal: controller.signal },
    );
    window.addEventListener('pointerup', () => finish(true), { signal: controller.signal });
    window.addEventListener('pointercancel', () => finish(false), { signal: controller.signal });
  };

  const nudge = (index: number) => (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    p.moveInQueue(index, index + delta);
  };

  const cover = p.current ? api.coverUrl(p.current) : null;

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={t('now.title')}
      ref={dialogRef}
      style={sheetDy ? { transform: `translateY(${sheetDy}px)` } : undefined}
      onPointerDown={(e) => {
        // Only a drag that starts on the sheet's own chrome counts as a dismiss swipe.
        if ((e.target as HTMLElement).closest('button, input, select, .sheet__queue')) return;
        swipe.current = { y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!swipe.current) return;
        setSheetDy(Math.max(0, e.clientY - swipe.current.y));
      }}
      onPointerUp={() => {
        if (swipe.current && sheetDy > 110) onClose();
        swipe.current = null;
        setSheetDy(0);
      }}
    >
      <div className="sheet__grab" aria-hidden />
      <button className="icon sheet__close" onClick={onClose} title={t('now.collapse')} aria-label={t('now.collapse')}>
        ⌄
      </button>

      <div className="sheet__body">
        <div className="sheet__art">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <div className="sheet__art--none" aria-hidden>
              ♪
            </div>
          )}
        </div>

        <div className="sheet__meta">
          <h2 title={p.current?.title}>{p.current?.title ?? t('player.nothingPlaying')}</h2>
          <p className="muted">
            {p.current?.artist || t('common.unknownArtist')}
            {p.current?.album ? ` · ${p.current.album}` : ''}
          </p>
        </div>

        <div className="sheet__seek">
          <SeekBar />
        </div>

        <div className="sheet__controls">
          <button className={`icon ${p.shuffle ? 'icon--active' : ''}`} onClick={p.toggleShuffle} title={t('player.shuffle')} aria-pressed={p.shuffle}>
            ⇄
          </button>
          <button className="icon" onClick={p.prev} disabled={!p.current} title={t('player.previous')}>
            ⏮
          </button>
          <button className="icon icon--big sheet__play" onClick={p.toggle} disabled={!p.current} title={p.playing ? t('player.pause') : t('player.play')}>
            {p.playing ? '⏸' : '▶'}
          </button>
          <button className="icon" onClick={p.next} disabled={!p.current} title={t('player.next')}>
            ⏭
          </button>
          <button
            className={`icon ${p.repeat !== 'off' ? 'icon--active' : ''}`}
            onClick={p.cycleRepeat}
            title={t('player.repeat', { mode: t(REPEAT_LABEL_KEY[p.repeat]) })}
          >
            {p.repeat === 'one' ? '↻¹' : '↻'}
          </button>
        </div>
      </div>

      <div className="sheet__queue">
        <div className="sheet__queuehead">
          <strong>{t('now.upNext')}</strong>
          <span className="muted">{t('common.tracks', { n: p.queue.length })}</span>
        </div>
        {p.queue.length === 0 ? (
          <p className="muted sheet__empty">{t('now.queueEmpty')}</p>
        ) : (
          <ol className="queue" ref={listRef}>
            {p.queue.map((track, i) => {
              const shift = drag ? shiftFor(i, drag.from, drag.to) : 0;
              const isDragged = drag?.from === i;
              const offset = isDragged ? drag.dy : shift * (drag?.rowStep ?? 0);
              return (
                <li
                  key={`${track.id}-${i}`}
                  className={`queue__row${i === p.index ? ' queue__row--current' : ''}${isDragged ? ' queue__row--dragging' : ''}`}
                  style={offset ? { transform: `translateY(${offset}px)` } : undefined}
                >
                  <button
                    className="queue__handle"
                    onPointerDown={startDrag(i)}
                    onKeyDown={nudge(i)}
                    title={t('now.dragToReorder')}
                    aria-label={t('now.reorder', { title: track.title })}
                  >
                    ⠿
                  </button>
                  <button className="queue__pick" onClick={() => p.playAt(i)} title={t('now.playThis')}>
                    <span className="queue__title">{track.title}</span>
                    <span className="muted queue__artist">{track.artist || t('common.unknownArtist')}</span>
                  </button>
                  <span className="mono muted queue__dur">{formatDuration(track.duration)}</span>
                  <button
                    className="icon queue__drop"
                    onClick={() => p.removeAt(i)}
                    title={t('now.removeFromQueue')}
                    aria-label={t('now.removeFromQueueNamed', { title: track.title })}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
