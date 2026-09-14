import { useMemo, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { usePlayer } from '../player/PlayerProvider';
import { TrackList } from './TrackList';
import { UploadButton } from './UploadButton';

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onRefresh: () => void;
  onAddToPlaylist: (playlistId: number, track: Track) => void;
  onEdit: (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  onDelete: (track: Track) => void;
}

export function Library({ tracks, playlists, onRefresh, onAddToPlaylist, onEdit, onDelete }: Props) {
  const player = usePlayer();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => [t.title, t.artist, t.album].some((s) => s.toLowerCase().includes(q)));
  }, [tracks, query]);

  return (
    <section>
      <header className="section__header">
        <h1>Library</h1>
        <input
          className="search"
          type="search"
          placeholder="Search title, artist, album…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search"
        />
        <button className="btn btn--ghost" onClick={() => player.shufflePlay(filtered)} disabled={filtered.length === 0}>
          ⇄ Shuffle
        </button>
        <UploadButton onUploaded={onRefresh} />
      </header>
      <TrackList
        tracks={filtered}
        playlists={playlists}
        onAddToPlaylist={onAddToPlaylist}
        onEdit={onEdit}
        onDelete={onDelete}
        emptyMessage={tracks.length === 0 ? 'No tracks yet. Upload some audio files to get started.' : 'No matches.'}
      />
    </section>
  );
}
