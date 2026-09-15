import { useCallback, useEffect, useState } from 'react';
import type { Playlist, Track } from '../shared/types';
import { api } from './api';
import { Library } from './components/Library';
import { PlayerBar } from './components/PlayerBar';
import { PlaylistView } from './components/PlaylistView';
import type { TrackPatch } from './components/TrackList';
import { usePlayer } from './player/PlayerProvider';

type View = { kind: 'library' } | { kind: 'playlist'; id: number };

export function App() {
  const player = usePlayer();
  const [view, setView] = useState<View>({ kind: 'library' });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState<string | null>(null);
  const [canImport, setCanImport] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2500);
  }, []);

  const refreshTracks = useCallback(() => {
    api.listTracks().then(setTracks).catch((e: Error) => notify(e.message));
    setVersion((v) => v + 1);
  }, [notify]);

  const refreshPlaylists = useCallback(() => {
    api.listPlaylists().then(setPlaylists).catch((e: Error) => notify(e.message));
    setVersion((v) => v + 1);
  }, [notify]);

  useEffect(() => {
    refreshTracks();
    refreshPlaylists();
    api
      .importSources()
      .then((s) => setCanImport(s.audioextract))
      .catch(() => setCanImport(false));
  }, [refreshTracks, refreshPlaylists]);

  const createPlaylist = async () => {
    const name = newPlaylistName?.trim();
    if (!name) return;
    try {
      const created = await api.createPlaylist(name);
      setNewPlaylistName(null);
      refreshPlaylists();
      setView({ kind: 'playlist', id: created.id });
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const addToPlaylist = async (playlistId: number, toAdd: Track[]) => {
    if (toAdd.length === 0) return;
    try {
      const before = playlists.find((p) => p.id === playlistId);
      const detail = await api.addToPlaylist(
        playlistId,
        toAdd.map((t) => t.id),
      );
      refreshPlaylists();
      const added = before ? detail.trackCount - before.trackCount : toAdd.length;
      const name = detail.name;
      notify(
        toAdd.length === 1
          ? added > 0
            ? `Added "${toAdd[0].title}" to ${name}`
            : `"${toAdd[0].title}" is already in ${name}`
          : `Added ${added} of ${toAdd.length} tracks to ${name}${added < toAdd.length ? ' (rest were already there)' : ''}`,
      );
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const editMany = async (toEdit: Track[], patch: TrackPatch) => {
    if (toEdit.length === 0) return;
    try {
      const updated = await api.updateTracks(
        toEdit.map((t) => t.id),
        patch,
      );
      updated.forEach((t) => player.updateTrack(t));
      refreshTracks();
      notify(`Updated ${updated.length} tracks`);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const deleteMany = async (toDelete: Track[]) => {
    if (toDelete.length === 0) return;
    if (!confirm(`Delete ${toDelete.length} tracks permanently? This also removes them from every playlist.`)) return;
    try {
      const { deleted } = await api.deleteTracks(toDelete.map((t) => t.id));
      toDelete.forEach((t) => player.removeTrack(t.id));
      refreshTracks();
      refreshPlaylists();
      notify(`Deleted ${deleted} tracks`);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const editTrack = async (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => {
    try {
      const updated = await api.updateTrack(track.id, patch);
      player.updateTrack(updated);
      refreshTracks();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const deleteTrack = async (track: Track) => {
    if (!confirm(`Delete "${track.title}" permanently?`)) return;
    try {
      await api.deleteTrack(track.id);
      player.removeTrack(track.id);
      refreshTracks();
      refreshPlaylists();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">♪ Musik</div>
        <button
          className={`nav ${view.kind === 'library' ? 'nav--active' : ''}`}
          onClick={() => setView({ kind: 'library' })}
        >
          Library
        </button>
        <div className="sidebar__heading">
          <span>Playlists</span>
          <button className="icon" onClick={() => setNewPlaylistName('')} title="New playlist">
            +
          </button>
        </div>
        {newPlaylistName !== null && (
          <form
            className="inline-form sidebar__new"
            onSubmit={(e) => {
              e.preventDefault();
              void createPlaylist();
            }}
          >
            <input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNewPlaylistName(null)}
              placeholder="Playlist name"
              aria-label="New playlist name"
              autoFocus
            />
            <button className="btn" type="submit" disabled={!newPlaylistName.trim()}>
              Add
            </button>
          </form>
        )}
        {playlists.map((pl) => (
          <button
            key={pl.id}
            className={`nav ${view.kind === 'playlist' && view.id === pl.id ? 'nav--active' : ''}`}
            onClick={() => setView({ kind: 'playlist', id: pl.id })}
          >
            {pl.name} <span className="muted">({pl.trackCount})</span>
          </button>
        ))}
      </nav>

      <main className="main">
        {view.kind === 'library' ? (
          <Library
            tracks={tracks}
            playlists={playlists}
            onRefresh={refreshTracks}
            canImport={canImport}
            notify={notify}
            onAddToPlaylist={(pid, ts) => void addToPlaylist(pid, ts)}
            onEdit={editTrack}
            onEditMany={editMany}
            onDelete={deleteTrack}
            onDeleteMany={(ts) => void deleteMany(ts)}
          />
        ) : (
          <PlaylistView
            key={view.id}
            id={view.id}
            playlists={playlists}
            library={tracks}
            version={version}
            onPlaylistsChanged={refreshPlaylists}
            onTracksChanged={refreshTracks}
            canImport={canImport}
            onDeleted={() => setView({ kind: 'library' })}
            onAddToPlaylist={addToPlaylist}
            onEdit={editTrack}
            onEditMany={editMany}
            onDelete={deleteTrack}
            onDeleteMany={(ts) => void deleteMany(ts)}
            notify={notify}
          />
        )}
      </main>

      <PlayerBar />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
