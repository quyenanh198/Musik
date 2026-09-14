import { useCallback, useEffect, useState } from 'react';
import type { Playlist, PlaylistDetail, Track } from '../../shared/types';
import { api } from '../api';
import { usePlayer } from '../player/PlayerProvider';
import { TrackList } from './TrackList';

interface Props {
  id: number;
  playlists: Playlist[];
  /** Bumped by the parent whenever tracks or playlists change elsewhere. */
  version: number;
  onPlaylistsChanged: () => void;
  onDeleted: () => void;
  onAddToPlaylist: (playlistId: number, track: Track) => void;
  onEdit: (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  onDelete: (track: Track) => void;
}

export function PlaylistView({
  id,
  playlists,
  version,
  onPlaylistsChanged,
  onDeleted,
  onAddToPlaylist,
  onEdit,
  onDelete,
}: Props) {
  const player = usePlayer();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    api
      .getPlaylist(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load, version]);

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const rename = async () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== detail.name) {
      await api.renamePlaylist(id, trimmed);
      onPlaylistsChanged();
    }
    setRenaming(false);
  };

  const remove = async () => {
    if (!confirm(`Delete playlist "${detail.name}"? Tracks stay in your library.`)) return;
    await api.deletePlaylist(id);
    onPlaylistsChanged();
    onDeleted();
  };

  const removeTrack = async (track: Track) => {
    await api.removeFromPlaylist(id, track.id);
    load();
    onPlaylistsChanged();
  };

  return (
    <section>
      <header className="section__header">
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Playlist name" />
            <button className="btn" type="submit">
              Save
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <h1>{detail.name}</h1>
        )}
        <span className="muted">{detail.trackCount} tracks</span>
        <div className="section__actions">
          <button className="btn" onClick={() => player.playQueue(detail.tracks, 0)} disabled={detail.tracks.length === 0}>
            ▶ Play all
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setName(detail.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button className="btn btn--ghost" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </header>
      <TrackList
        tracks={detail.tracks}
        playlists={playlists.filter((p) => p.id !== id)}
        onAddToPlaylist={onAddToPlaylist}
        onEdit={onEdit}
        onDelete={onDelete}
        onRemove={(t) => void removeTrack(t)}
        emptyMessage="This playlist is empty. Add tracks from the library."
      />
    </section>
  );
}
