import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDuration } from '../api';
import { usePlayer } from '../player/PlayerProvider';
import { dropIndex, shiftFor } from '../queueOrder';

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
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Swipe the sheet down to dismiss, the way the bar swipes up to open it.
  const [sheetDy, setSheetDy] = useState(0);
  const swipe = useRef<{ y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    const rowStep = rowStepOf(index);
    const startY = e.clientY;
    setDrag({ from: index, to: index, dy: 0, rowStep });

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      setDrag((d) => (d ? { ...d, dy, to: dropIndex(d.from, dy, d.rowStep, p.queue.length) } : d));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag((d) => {
        if (d && d.to !== d.from) p.moveInQueue(d.from, d.to);
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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
      aria-label="Đang phát"
      ref={sheetRef}
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
      <button className="icon sheet__close" onClick={onClose} title="Thu gọn" aria-label="Thu gọn">
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
          <h2 title={p.current?.title}>{p.current?.title ?? 'Nothing playing'}</h2>
          <p className="muted">
            {p.current?.artist || 'Unknown artist'}
            {p.current?.album ? ` · ${p.current.album}` : ''}
          </p>
        </div>

        <div className="sheet__seek">
          <span className="mono">{formatDuration(p.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={p.duration || 0}
            step={0.5}
            value={Math.min(p.currentTime, p.duration || 0)}
            disabled={!p.current || !p.duration}
            onChange={(e) => p.seek(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className="mono">{formatDuration(p.duration)}</span>
        </div>

        <div className="sheet__controls">
          <button
            className={`icon ${p.shuffle ? 'icon--active' : ''}`}
            onClick={p.toggleShuffle}
            title="Shuffle"
            aria-pressed={p.shuffle}
          >
            ⇄
          </button>
          <button className="icon" onClick={p.prev} disabled={!p.current} title="Previous">
            ⏮
          </button>
          <button
            className="icon icon--big sheet__play"
            onClick={p.toggle}
            disabled={!p.current}
            title={p.playing ? 'Pause' : 'Play'}
          >
            {p.playing ? '⏸' : '▶'}
          </button>
          <button className="icon" onClick={p.next} disabled={!p.current} title="Next">
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
      </div>

      <div className="sheet__queue">
        <div className="sheet__queuehead">
          <strong>Tiếp theo trong hàng đợi</strong>
          <span className="muted">{p.queue.length} bài</span>
        </div>
        {p.queue.length === 0 ? (
          <p className="muted sheet__empty">Hàng đợi trống.</p>
        ) : (
          <ol className="queue" ref={listRef}>
            {p.queue.map((track, i) => {
              const shift = drag ? shiftFor(i, drag.from, drag.to) : 0;
              const isDragged = drag?.from === i;
              const offset = isDragged ? drag!.dy : shift * (drag?.rowStep ?? 0);
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
                    title="Kéo để đổi thứ tự"
                    aria-label={`Đổi thứ tự: ${track.title}`}
                  >
                    ⠿
                  </button>
                  <button className="queue__pick" onClick={() => p.playAt(i)} title="Phát bài này">
                    <span className="queue__title">{track.title}</span>
                    <span className="muted queue__artist">{track.artist || 'Unknown artist'}</span>
                  </button>
                  <span className="mono muted queue__dur">{formatDuration(track.duration)}</span>
                  <button
                    className="icon queue__drop"
                    onClick={() => p.removeAt(i)}
                    title="Bỏ khỏi hàng đợi"
                    aria-label={`Bỏ khỏi hàng đợi: ${track.title}`}
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
