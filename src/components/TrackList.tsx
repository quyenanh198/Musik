import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { api, formatDuration, type TrackPatch } from '../api';
import { useI18n } from '../I18nProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useDialogFocus } from '../useDialogFocus';
import { useLatest } from '../useLatest';

export type { TrackPatch }; // re-exported for callers

/** What to do with a track's cover image on save. */
export type CoverChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'set'; file: File };

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => void;
  onEdit: (track: Track, patch: TrackPatch, cover: CoverChange) => Promise<void>;
  /** Apply the same tags (and optionally one cover) to many tracks at once. Rejects when it fails, so the form can say why. */
  onEditMany: (tracks: Track[], patch: TrackPatch, cover: File | null) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
  /** Shown as a "remove" action when set (e.g. remove from playlist). */
  onRemove?: (track: Track) => void;
  onRemoveMany?: (tracks: Track[]) => void;
  /** Shown as up/down buttons when set (the order of a playlist). `toIndex` is where the track should end up. */
  onMove?: (track: Track, toIndex: number) => void;
  emptyMessage: string;
}

/** Row callbacks in one stable object, so a row only re-renders when its own data changes. */
interface RowActions {
  play: (index: number) => void;
  toggle: (id: number) => void;
  add: (playlistId: number, track: Track) => void;
  edit: (track: Track) => void;
  remove: (track: Track) => void;
  del: (track: Track) => void;
  move: (track: Track, toIndex: number) => void;
}

interface RowProps {
  track: Track;
  index: number;
  count: number;
  isCurrent: boolean;
  isPlaying: boolean;
  selected: boolean;
  playlists: Playlist[];
  canRemove: boolean;
  canMove: boolean;
  actions: RowActions;
}

const TrackRow = memo(function TrackRow({ track, index, count, isCurrent, isPlaying, selected, playlists, canRemove, canMove, actions }: RowProps) {
  const { t } = useI18n();
  const cover = api.coverUrl(track);
  return (
    <tr
      className={`tracks__row${isCurrent ? ' tracks__row--current' : ''}${selected ? ' tracks__row--selected' : ''}`}
      // Clicking anywhere on the row plays it; the checkbox, selects and action
      // buttons keep their own behaviour, and a text selection is not a click.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, select, input, label, a')) return;
        if (window.getSelection()?.toString()) return;
        actions.play(index);
      }}
    >
      <td className="tracks__check">
        <input type="checkbox" checked={selected} onChange={() => actions.toggle(track.id)} aria-label={t('list.select', { title: track.title })} />
      </td>
      <td className="tracks__num">
        <button className="icon" onClick={() => actions.play(index)} title={t('list.play')} aria-label={t('list.playNamed', { title: track.title })}>
          {isCurrent && isPlaying ? '♫' : '▶'}
        </button>
      </td>
      <td>
        <div className="tracks__titlecell">
          {cover ? <img className="tracks__cover" src={cover} alt="" loading="lazy" /> : <div className="tracks__cover tracks__cover--none">♪</div>}
          <div className="tracks__text">
            <div className="tracks__title">{track.title}</div>
            <div className="muted">
              {track.artist || t('common.unknownArtist')}
              {track.year ? ` · ${track.year}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="hide-sm muted">
        {track.album}
        {track.genre && <div className="tracks__genre">{track.genre}</div>}
      </td>
      <td className="tracks__dur mono muted">{formatDuration(track.duration)}</td>
      <td className="tracks__actions">
        {playlists.length > 0 && (
          <select
            className="select"
            value=""
            title={t('list.addToPlaylist')}
            aria-label={t('list.addToPlaylist')}
            onChange={(e) => {
              if (e.target.value) actions.add(Number(e.target.value), track);
            }}
          >
            <option value="">{t('list.addToPlaylistShort')}</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
        )}
        {canMove && (
          <>
            <button className="icon" onClick={() => actions.move(track, index - 1)} disabled={index === 0} title={t('list.moveUp')} aria-label={t('list.moveUpNamed', { title: track.title })}>
              ↑
            </button>
            <button className="icon" onClick={() => actions.move(track, index + 1)} disabled={index === count - 1} title={t('list.moveDown')} aria-label={t('list.moveDownNamed', { title: track.title })}>
              ↓
            </button>
          </>
        )}
        <button className="icon" onClick={() => actions.edit(track)} title={t('list.edit')} aria-label={t('list.editNamed', { title: track.title })}>
          ✎
        </button>
        {canRemove && (
          <button className="icon" onClick={() => actions.remove(track)} title={t('list.removeFromPlaylist')} aria-label={t('list.removeFromPlaylist')}>
            −
          </button>
        )}
        <button className="icon icon--danger" onClick={() => actions.del(track)} title={t('list.delete')} aria-label={t('list.deleteNamed', { title: track.title })}>
          🗑
        </button>
      </td>
    </tr>
  );
});

export function TrackList({
  tracks,
  playlists,
  onAddToPlaylist,
  onEdit,
  onEditMany,
  onDelete,
  onDeleteMany,
  onRemove,
  onRemoveMany,
  onMove,
  emptyMessage,
}: Props) {
  const player = usePlayer();
  const { t } = useI18n();
  const [editing, setEditing] = useState<Track | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);

  // Drop selections that no longer exist (deleted, removed, filtered away). Done while rendering, when the list
  // changes, so the stale selection is never shown even for one frame.
  const [seenTracks, setSeenTracks] = useState(tracks);
  if (tracks !== seenTracks) {
    setSeenTracks(tracks);
    const ids = new Set(tracks.map((track) => track.id));
    const kept = new Set([...selected].filter((id) => ids.has(id)));
    if (kept.size !== selected.size) setSelected(kept);
  }

  const selectedTracks = useMemo(() => tracks.filter((track) => selected.has(track.id)), [tracks, selected]);
  const allSelected = tracks.length > 0 && selectedTracks.length === tracks.length;

  // Row callbacks read the latest props through a ref, so the actions object below never changes identity.
  const latest = useLatest({ tracks, onAddToPlaylist, onDelete, onRemove, onMove, playQueue: player.playQueue });
  const actions = useMemo<RowActions>(
    () => ({
      play: (index) => latest.current.playQueue(latest.current.tracks, index),
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      add: (playlistId, track) => latest.current.onAddToPlaylist(playlistId, [track]),
      edit: setEditing,
      remove: (track) => latest.current.onRemove?.(track),
      del: (track) => latest.current.onDelete(track),
      move: (track, toIndex) => latest.current.onMove?.(track, toIndex),
    }),
    [latest],
  );

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tracks.map((track) => track.id)));
  const clear = () => {
    setSelected(new Set());
    setBulkEditing(false);
  };

  if (tracks.length === 0) return <p className="muted">{emptyMessage}</p>;

  const n = selectedTracks.length;
  const currentId = player.current?.id ?? null;

  return (
    <>
      {n > 0 && (
        <div className="batch" role="toolbar" aria-label={t('list.batch')}>
          <span className="batch__count">{t('list.selected', { n })}</span>
          {playlists.length > 0 && (
            <select
              className="select"
              value=""
              title={t('list.addSelectedToPlaylist')}
              aria-label={t('list.addSelectedToPlaylist')}
              onChange={(e) => {
                if (e.target.value) onAddToPlaylist(Number(e.target.value), selectedTracks);
              }}
            >
              <option value="">{t('list.addToPlaylistLong')}</option>
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn--ghost" onClick={() => player.playQueue(selectedTracks, 0)}>
            ▶ {t('list.playN', { n })}
          </button>
          <button className={`btn btn--ghost${bulkEditing ? ' btn--on' : ''}`} onClick={() => setBulkEditing((v) => !v)}>
            ✎ {t('list.editN', { n })}
          </button>
          {onRemoveMany && (
            <button className="btn btn--ghost" onClick={() => onRemoveMany(selectedTracks)}>
              − {t('list.removeN', { n })}
            </button>
          )}
          <button className="btn btn--ghost btn--danger" onClick={() => onDeleteMany(selectedTracks)}>
            🗑 {t('list.deleteN', { n })}
          </button>
          <button className="btn btn--ghost" onClick={clear}>
            {t('common.clear')}
          </button>
        </div>
      )}
      {n > 0 && bulkEditing && (
        <BulkEditForm
          count={n}
          onCancel={() => setBulkEditing(false)}
          onSave={async (patch, cover) => {
            await onEditMany(selectedTracks, patch, cover);
            setBulkEditing(false);
          }}
        />
      )}
      {editing && (
        <TrackEditor
          track={editing}
          onCancel={() => setEditing(null)}
          onSave={async (patch, cover) => {
            await onEdit(editing, patch, cover);
            setEditing(null);
          }}
        />
      )}
      <table className="tracks">
        <thead>
          <tr>
            <th className="tracks__check">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('list.selectAll')} title={t('list.selectAll')} />
            </th>
            <th className="tracks__num">#</th>
            <th>{t('list.colTitle')}</th>
            <th className="hide-sm">{t('list.colAlbum')}</th>
            <th className="tracks__dur">⏱</th>
            <th className="tracks__actions"></th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              count={tracks.length}
              isCurrent={currentId === track.id}
              isPlaying={player.playing}
              selected={selected.has(track.id)}
              playlists={playlists}
              canRemove={Boolean(onRemove)}
              canMove={Boolean(onMove)}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Pick an image file; returns a preview URL that is revoked on unmount. */
function useCoverPick() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const input = (
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
  );
  return { input, file, preview, choose: () => inputRef.current?.click(), reset: () => setFile(null) };
}

/** Full metadata editor for one track: tags + cover image. */
function TrackEditor({
  track,
  onSave,
  onCancel,
}: {
  track: Track;
  onSave: (patch: TrackPatch, cover: CoverChange) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const [genre, setGenre] = useState(track.genre);
  const [year, setYear] = useState(track.year ? String(track.year) : '');
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(onCancel, saving);
  const [error, setError] = useState<string | null>(null);
  const pick = useCoverPick();

  const currentCover = api.coverUrl(track);
  const shownCover = pick.preview ?? (removeCover ? null : currentCover);
  const yearValid = year.trim() === '' || /^\d{1,4}$/.test(year.trim());

  const submit = async () => {
    if (!title.trim() || !yearValid) return;
    setSaving(true);
    setError(null);
    try {
      const patch: TrackPatch = { title, artist, album, genre, year: year.trim() === '' ? null : Number(year) };
      const cover: CoverChange = pick.file ? { kind: 'set', file: pick.file } : removeCover ? { kind: 'remove' } : { kind: 'keep' };
      await onSave(patch, cover);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onCancel}>
      <form
        ref={dialogRef}
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-label={t('editor.title')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal__head">
          <strong>{t('editor.title')}</strong>
          <span className="muted editor__file">
            {formatDuration(track.duration)} · {track.mimeType}
          </span>
        </div>
        <div className="editor__body">
          <div className="editor__coverbox">
            {shownCover ? <img className="editor__cover" src={shownCover} alt={t('editor.cover')} /> : <div className="editor__cover editor__cover--none">♪</div>}
            {pick.input}
            <div className="editor__coveractions">
              <button className="btn btn--ghost" type="button" onClick={pick.choose} disabled={saving}>
                {shownCover ? t('editor.changeImage') : t('editor.addImage')}
              </button>
              {shownCover && (
                <button
                  className="btn btn--ghost btn--danger"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    pick.reset();
                    setRemoveCover(true);
                  }}
                >
                  {t('common.remove')}
                </button>
              )}
            </div>
          </div>
          <div className="editor__fields">
            <label className="editor__field editor__field--wide">
              <span>{t('editor.fieldTitle')}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
            </label>
            <label className="editor__field">
              <span>{t('editor.artist')}</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={300} />
            </label>
            <label className="editor__field">
              <span>{t('editor.album')}</span>
              <input value={album} onChange={(e) => setAlbum(e.target.value)} maxLength={300} />
            </label>
            <label className="editor__field">
              <span>{t('editor.genre')}</span>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t('editor.genrePlaceholder')} maxLength={300} />
            </label>
            <label className="editor__field">
              <span>{t('editor.year')}</span>
              <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="2024" className={yearValid ? '' : 'input--bad'} />
            </label>
          </div>
        </div>
        {error && (
          <p className="error editor__error" role="alert">
            {error}
          </p>
        )}
        <div className="modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button className="btn" type="submit" disabled={saving || !title.trim() || !yearValid}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function BulkEditForm({
  count,
  onSave,
  onCancel,
}: {
  count: number;
  onSave: (patch: TrackPatch, cover: File | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [on, setOn] = useState({ artist: true, album: false, genre: false, year: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = useCoverPick();
  const yearValid = year.trim() === '' || /^\d{1,4}$/.test(year.trim());
  const nothing = !on.artist && !on.album && !on.genre && !on.year && !pick.file;

  // A failed save keeps the form and what was typed, and says why; only success closes it (the caller does that).
  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: TrackPatch = {};
      if (on.artist) patch.artist = artist;
      if (on.album) patch.album = album;
      if (on.genre) patch.genre = genre;
      if (on.year) patch.year = year.trim() === '' ? null : Number(year);
      await onSave(patch, pick.file);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof on, label: string, value: string, set: (v: string) => void, extra?: object) => (
    <label className="bulk-edit__field">
      <input type="checkbox" checked={on[key]} onChange={(e) => setOn((o) => ({ ...o, [key]: e.target.checked }))} aria-label={t('bulk.change', { field: label })} />
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={label} aria-label={label} disabled={!on[key]} maxLength={300} {...extra} />
    </label>
  );

  return (
    <form
      className="bulk-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="muted">{t('bulk.hint', { n: count })}</div>
      <div className="bulk-edit__row">
        {field('artist', t('editor.artist'), artist, setArtist)}
        {field('album', t('editor.album'), album, setAlbum)}
        {field('genre', t('editor.genre'), genre, setGenre)}
        {field('year', t('editor.year'), year, setYear, { inputMode: 'numeric', className: yearValid ? '' : 'input--bad' })}
      </div>
      <div className="bulk-edit__row">
        {pick.input}
        <button className="btn btn--ghost" type="button" onClick={pick.choose} disabled={saving}>
          🖼 {pick.file ? t('bulk.coverChosen', { name: pick.file.name }) : t('bulk.setCover')}
        </button>
        {pick.file && (
          <button className="btn btn--ghost" type="button" onClick={pick.reset} disabled={saving} aria-label={t('bulk.clearCover')}>
            ✕
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" type="submit" disabled={saving || nothing || !yearValid}>
          {t('bulk.save', { n: count })}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
