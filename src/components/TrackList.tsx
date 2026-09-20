import { useEffect, useMemo, useRef, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { api, formatDuration, type TrackPatch } from '../api';
import { usePlayer } from '../player/PlayerProvider';
import { useDialogFocus } from '../useDialogFocus';

export type { TrackPatch };

/** What to do with a track's cover image on save. */
export type CoverChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'set'; file: File };

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => void;
  onEdit: (track: Track, patch: TrackPatch, cover: CoverChange) => Promise<void>;
  /** Apply the same tags (and optionally one cover) to many tracks at once. */
  onEditMany: (tracks: Track[], patch: TrackPatch, cover: File | null) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
  /** Shown as a "remove" action when set (e.g. remove from playlist). */
  onRemove?: (track: Track) => void;
  onRemoveMany?: (tracks: Track[]) => void;
  emptyMessage: string;
}

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
  emptyMessage,
}: Props) {
  const player = usePlayer();
  const [editing, setEditing] = useState<Track | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);

  // Drop selections that no longer exist (deleted, removed, filtered away).
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tracks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tracks]);

  const selectedTracks = useMemo(() => tracks.filter((t) => selected.has(t.id)), [tracks, selected]);
  const allSelected = tracks.length > 0 && selectedTracks.length === tracks.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tracks.map((t) => t.id)));
  const clear = () => {
    setSelected(new Set());
    setBulkEditing(false);
  };

  if (tracks.length === 0) return <p className="muted">{emptyMessage}</p>;

  const n = selectedTracks.length;

  return (
    <>
      {n > 0 && (
        <div className="batch" role="toolbar" aria-label="Batch actions">
          <span className="batch__count">{n} selected</span>
          {playlists.length > 0 && (
            <select
              className="select"
              value=""
              title="Add selected to playlist"
              onChange={(e) => {
                if (e.target.value) onAddToPlaylist(Number(e.target.value), selectedTracks);
              }}
            >
              <option value="">+ Add to playlist</option>
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn--ghost" onClick={() => player.playQueue(selectedTracks, 0)}>
            ▶ Play {n}
          </button>
          <button className={`btn btn--ghost${bulkEditing ? ' btn--on' : ''}`} onClick={() => setBulkEditing((v) => !v)}>
            ✎ Edit {n}
          </button>
          {onRemoveMany && (
            <button className="btn btn--ghost" onClick={() => onRemoveMany(selectedTracks)}>
              − Remove {n}
            </button>
          )}
          <button className="btn btn--ghost btn--danger" onClick={() => onDeleteMany(selectedTracks)}>
            🗑 Delete {n}
          </button>
          <button className="btn btn--ghost" onClick={clear}>
            Clear
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
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" title="Select all" />
            </th>
            <th className="tracks__num">#</th>
            <th>Title</th>
            <th className="hide-sm">Album</th>
            <th className="tracks__dur">⏱</th>
            <th className="tracks__actions"></th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, i) => {
            const isCurrent = player.current?.id === track.id;
            const isSelected = selected.has(track.id);
            const cover = api.coverUrl(track);
            return (
              <tr
                key={track.id}
                className={`tracks__row${isCurrent ? ' tracks__row--current' : ''}${isSelected ? ' tracks__row--selected' : ''}`}
                // Clicking anywhere on the row plays it; the checkbox, selects and action
                // buttons keep their own behaviour, and a text selection is not a click.
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button, select, input, label, a')) return;
                  if (window.getSelection()?.toString()) return;
                  player.playQueue(tracks, i);
                }}
              >
                <td className="tracks__check">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(track.id)}
                    aria-label={`Select ${track.title}`}
                  />
                </td>
                <td className="tracks__num">
                  <button className="icon" onClick={() => player.playQueue(tracks, i)} title="Play">
                    {isCurrent && player.playing ? '♫' : '▶'}
                  </button>
                </td>
                <td>
                  <div className="tracks__titlecell">
                    {cover ? <img className="tracks__cover" src={cover} alt="" loading="lazy" /> : <div className="tracks__cover tracks__cover--none">♪</div>}
                    <div className="tracks__text">
                      <div className="tracks__title">{track.title}</div>
                      <div className="muted">
                        {track.artist || 'Unknown artist'}
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
                      title="Add to playlist"
                      onChange={(e) => {
                        if (e.target.value) onAddToPlaylist(Number(e.target.value), [track]);
                      }}
                    >
                      <option value="">+ Playlist</option>
                      {playlists.map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="icon" onClick={() => setEditing(track)} title="Edit metadata">
                    ✎
                  </button>
                  {onRemove && (
                    <button className="icon" onClick={() => onRemove(track)} title="Remove from playlist">
                      −
                    </button>
                  )}
                  <button className="icon icon--danger" onClick={() => onDelete(track)} title="Delete track">
                    🗑
                  </button>
                </td>
              </tr>
            );
          })}
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
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      hidden
      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
    />
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
        aria-label="Edit metadata"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal__head">
          <strong>Edit metadata</strong>
          <span className="muted editor__file">{formatDuration(track.duration)} · {track.mimeType}</span>
        </div>
        <div className="editor__body">
          <div className="editor__coverbox">
            {shownCover ? <img className="editor__cover" src={shownCover} alt="Cover" /> : <div className="editor__cover editor__cover--none">♪</div>}
            {pick.input}
            <div className="editor__coveractions">
              <button className="btn btn--ghost" type="button" onClick={pick.choose} disabled={saving}>
                {shownCover ? 'Change image' : 'Add image'}
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
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="editor__fields">
            <label className="editor__field editor__field--wide">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </label>
            <label className="editor__field">
              <span>Artist</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <label className="editor__field">
              <span>Album</span>
              <input value={album} onChange={(e) => setAlbum(e.target.value)} />
            </label>
            <label className="editor__field">
              <span>Genre</span>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Pop, Rock, Ballad…" />
            </label>
            <label className="editor__field">
              <span>Year</span>
              <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="2024" className={yearValid ? '' : 'input--bad'} />
            </label>
          </div>
        </div>
        {error && <p className="error editor__error">{error}</p>}
        <div className="modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={saving || !title.trim() || !yearValid}>
            {saving ? 'Saving…' : 'Save'}
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
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [on, setOn] = useState({ artist: true, album: false, genre: false, year: false });
  const [saving, setSaving] = useState(false);
  const pick = useCoverPick();
  const yearValid = year.trim() === '' || /^\d{1,4}$/.test(year.trim());
  const nothing = !on.artist && !on.album && !on.genre && !on.year && !pick.file;

  const submit = async () => {
    setSaving(true);
    try {
      const patch: TrackPatch = {};
      if (on.artist) patch.artist = artist;
      if (on.album) patch.album = album;
      if (on.genre) patch.genre = genre;
      if (on.year) patch.year = year.trim() === '' ? null : Number(year);
      await onSave(patch, pick.file);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof on, value: string, set: (v: string) => void, placeholder: string, extra?: object) => (
    <label className="bulk-edit__field">
      <input type="checkbox" checked={on[key]} onChange={(e) => setOn((o) => ({ ...o, [key]: e.target.checked }))} aria-label={`Change ${key}`} />
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} aria-label={placeholder} disabled={!on[key]} {...extra} />
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
      <div className="muted">Edit {count} tracks — only ticked fields change; an empty value clears that field.</div>
      <div className="bulk-edit__row">
        {field('artist', artist, setArtist, 'Artist')}
        {field('album', album, setAlbum, 'Album')}
        {field('genre', genre, setGenre, 'Genre')}
        {field('year', year, setYear, 'Year', { inputMode: 'numeric', className: yearValid ? '' : 'input--bad' })}
      </div>
      <div className="bulk-edit__row">
        {pick.input}
        <button className="btn btn--ghost" type="button" onClick={pick.choose} disabled={saving}>
          🖼 {pick.file ? `Cover: ${pick.file.name}` : 'Set one cover for all'}
        </button>
        {pick.file && (
          <button className="btn btn--ghost" type="button" onClick={pick.reset} disabled={saving}>
            ✕
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" type="submit" disabled={saving || nothing || !yearValid}>
          Save {count}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
