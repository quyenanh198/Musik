import { useCallback, useEffect, useState } from 'react';
import type { Playlist, Track } from '../shared/types';
import { api } from './api';
import { Library } from './components/Library';
import { PlayerBar } from './components/PlayerBar';
import { PlaylistView } from './components/PlaylistView';
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

  const addToPlaylist = async (playlistId: number, track: Track) => {
    try {
      await api.addToPlaylist(playlistId, track.id);
      refreshPlaylists();
      notify(`Added "${track.title}" to ${playlists.find((p) => p.id === playlistId)?.name ?? 'playlist'}`);
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
            onAddToPlaylist={addToPlaylist}
            onEdit={editTrack}
            onDelete={deleteTrack}
          />
        ) : (
          <PlaylistView
            key={view.id}
            id={view.id}
            playlists={playlists}
            version={version}
            onPlaylistsChanged={refreshPlaylists}
            onDeleted={() => setView({ kind: 'library' })}
            onAddToPlaylist={addToPlaylist}
            onEdit={editTrack}
            onDelete={deleteTrack}
          />
        )}
      </main>

      <PlayerBar />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
