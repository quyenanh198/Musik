import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Playlist, PlaylistDetail, Track } from '../../shared/types';
import { api } from '../api';
import { usePlayer } from '../player/PlayerProvider';
import { TrackList, type TrackPatch } from './TrackList';
import { UploadButton } from './UploadButton';

interface Props {
  id: number;
  playlists: Playlist[];
  /** Every library track — the "add from library" picker offers the ones not yet in this playlist. */
  library: Track[];
  /** Bumped by the parent whenever tracks or playlists change elsewhere. */
  version: number;
  onPlaylistsChanged: () => void;
  onTracksChanged: () => void;
  onDeleted: () => void;
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => Promise<void>;
  onEdit: (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  onEditMany: (tracks: Track[], patch: TrackPatch) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
  notify: (message: string) => void;
}

export function PlaylistView({
  id,
  playlists,
  library,
  version,
  onPlaylistsChanged,
  onTracksChanged,
  onDeleted,
  onAddToPlaylist,
  onEdit,
  onEditMany,
  onDelete,
  onDeleteMany,
  notify,
}: Props) {
  const player = usePlayer();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);

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

  const removeTracks = async (tracks: Track[]) => {
    try {
      if (tracks.length === 1) await api.removeFromPlaylist(id, tracks[0].id);
      else await api.removeManyFromPlaylist(id, tracks.map((t) => t.id));
      load();
      onPlaylistsChanged();
      if (tracks.length > 1) notify(`Removed ${tracks.length} tracks from ${detail.name}`);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  // Files uploaded from inside a playlist go straight into it.
  const uploadedHere = async (tracks: Track[], done: boolean) => {
    if (tracks.length === 0) return;
    if (!done) {
      // Per-file: add as it lands so the list fills up while the rest upload.
      try {
        await api.addToPlaylist(id, tracks.map((t) => t.id));
      } catch (e) {
        notify((e as Error).message);
      }
      load();
      onTracksChanged();
      onPlaylistsChanged();
      return;
    }
    notify(`Uploaded ${tracks.length} tracks into ${detail.name}`);
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
          <button className="btn btn--ghost" onClick={() => player.shufflePlay(detail.tracks)} disabled={detail.tracks.length === 0}>
            ⇄ Shuffle
          </button>
          <button className="btn btn--ghost" onClick={() => setPicking(true)}>
            + Add from library
          </button>
          <UploadButton onUploaded={(t, done) => void uploadedHere(t, done)} label="⬆ Upload here" />
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
      {picking && (
        <LibraryPicker
          library={library}
          exclude={new Set(detail.tracks.map((t) => t.id))}
          onClose={() => setPicking(false)}
          onAdd={async (tracks) => {
            await onAddToPlaylist(id, tracks);
            setPicking(false);
            load();
          }}
        />
      )}
      <TrackList
        tracks={detail.tracks}
        playlists={playlists.filter((p) => p.id !== id)}
        onAddToPlaylist={(pid, tracks) => void onAddToPlaylist(pid, tracks)}
        onEdit={onEdit}
        onEditMany={onEditMany}
        onDelete={onDelete}
        onDeleteMany={onDeleteMany}
        onRemove={(t) => void removeTracks([t])}
        onRemoveMany={(ts) => void removeTracks(ts)}
        emptyMessage="This playlist is empty. Add tracks from the library or upload here."
      />
    </section>
  );
}

/** Multi-select picker over the library for tracks not yet in the playlist. */
function LibraryPicker({
  library,
  exclude,
  onAdd,
  onClose,
}: {
  library: Track[];
  exclude: Set<number>;
  onAdd: (tracks: Track[]) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library
      .filter((t) => !exclude.has(t.id))
      .filter((t) => !q || [t.title, t.artist, t.album].some((s) => s.toLowerCase().includes(q)));
  }, [library, exclude, query]);

  const allShown = candidates.length > 0 && candidates.every((t) => chosen.has(t.id));
  const toggle = (id: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllShown = () =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (allShown) candidates.forEach((t) => next.delete(t.id));
      else candidates.forEach((t) => next.add(t.id));
      return next;
    });

  const submit = async () => {
    const tracks = library.filter((t) => chosen.has(t.id));
    if (tracks.length === 0) return;
    setBusy(true);
    try {
      await onAdd(tracks);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Add from library" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <strong>Add from library</strong>
          <input
            className="search"
            type="search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search library"
            autoFocus
          />
          <label className="modal__all">
            <input type="checkbox" checked={allShown} onChange={toggleAllShown} disabled={candidates.length === 0} />
            All shown ({candidates.length})
          </label>
        </div>
        <div className="modal__list">
          {candidates.length === 0 ? (
            <p className="muted">{library.length - exclude.size === 0 ? 'Every library track is already in this playlist.' : 'No matches.'}</p>
          ) : (
            candidates.map((t) => (
              <label key={t.id} className={`pick${chosen.has(t.id) ? ' pick--on' : ''}`}>
                <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} />
                <span className="pick__title">{t.title}</span>
                <span className="muted">{t.artist || 'Unknown artist'}</span>
              </label>
            ))
          )}
        </div>
        <div className="modal__foot">
          <span className="muted">{chosen.size} selected</span>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => void submit()} disabled={busy || chosen.size === 0}>
            Add {chosen.size || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
