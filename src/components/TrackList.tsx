import { useEffect, useMemo, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { formatDuration } from '../api';
import { usePlayer } from '../player/PlayerProvider';

export type TrackPatch = Partial<Pick<Track, 'title' | 'artist' | 'album'>>;

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => void;
  onEdit: (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  /** Apply the same artist/album to many tracks at once. */
  onEditMany: (tracks: Track[], patch: TrackPatch) => Promise<void>;
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
  const [editing, setEditing] = useState<number | null>(null);
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
          onSave={async (patch) => {
            await onEditMany(selectedTracks, patch);
            setBulkEditing(false);
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
            return editing === track.id ? (
              <EditRow
                key={track.id}
                track={track}
                onCancel={() => setEditing(null)}
                onSave={async (patch) => {
                  await onEdit(track, patch);
                  setEditing(null);
                }}
              />
            ) : (
              <tr
                key={track.id}
                className={`tracks__row${isCurrent ? ' tracks__row--current' : ''}${isSelected ? ' tracks__row--selected' : ''}`}
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
                  <div className="tracks__title">{track.title}</div>
                  <div className="muted">{track.artist || 'Unknown artist'}</div>
                </td>
                <td className="hide-sm muted">{track.album}</td>
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
                  <button className="icon" onClick={() => setEditing(track.id)} title="Edit">
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

function BulkEditForm({
  count,
  onSave,
  onCancel,
}: {
  count: number;
  onSave: (patch: TrackPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [setArtistOn, setSetArtistOn] = useState(true);
  const [setAlbumOn, setSetAlbumOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const nothing = !setArtistOn && !setAlbumOn;

  const submit = async () => {
    setSaving(true);
    try {
      const patch: TrackPatch = {};
      if (setArtistOn) patch.artist = artist;
      if (setAlbumOn) patch.album = album;
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };

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
        <label className="bulk-edit__field">
          <input type="checkbox" checked={setArtistOn} onChange={(e) => setSetArtistOn(e.target.checked)} aria-label="Change artist" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" aria-label="Artist" disabled={!setArtistOn} />
        </label>
        <label className="bulk-edit__field">
          <input type="checkbox" checked={setAlbumOn} onChange={(e) => setSetAlbumOn(e.target.checked)} aria-label="Change album" />
          <input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album" aria-label="Album" disabled={!setAlbumOn} />
        </label>
        <button className="btn" type="submit" disabled={saving || nothing}>
          Save {count}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditRow({
  track,
  onSave,
  onCancel,
}: {
  track: Track;
  onSave: (patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ title, artist, album });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="tracks__row tracks__row--editing">
      <td className="tracks__check"></td>
      <td className="tracks__num"></td>
      <td colSpan={3}>
        <div className="edit">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" aria-label="Artist" />
          <input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album" aria-label="Album" />
        </div>
      </td>
      <td className="tracks__actions">
        <button className="btn" onClick={submit} disabled={saving || !title.trim()}>
          Save
        </button>
        <button className="btn btn--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </td>
    </tr>
  );
}
