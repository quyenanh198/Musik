import { useMemo, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { usePlayer } from '../player/PlayerProvider';
import { TrackList, type CoverChange, type TrackPatch } from './TrackList';
import { UploadButton } from './UploadButton';
import { ImportPicker } from './ImportPicker';

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onRefresh: () => void;
  /** AudioExtract results can be pulled in (server has AUDIOEXTRACT_URL). */
  canImport: boolean;
  notify: (message: string) => void;
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => void;
  onEdit: (track: Track, patch: TrackPatch, cover: CoverChange) => Promise<void>;
  onEditMany: (tracks: Track[], patch: TrackPatch, cover: File | null) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
}

export function Library({ tracks, playlists, onRefresh, canImport, notify, onAddToPlaylist, onEdit, onEditMany, onDelete, onDeleteMany }: Props) {
  const player = usePlayer();
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);

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
        {canImport && (
          <button className="btn btn--ghost" onClick={() => setImporting(true)}>
            ⤓ From AudioExtract
          </button>
        )}
      </header>
      {importing && (
        <ImportPicker
          onClose={() => setImporting(false)}
          onDone={(imported, failed) => {
            setImporting(false);
            onRefresh();
            notify(`Imported ${imported.length} tracks${failed.length ? `, ${failed.length} failed` : ''}`);
          }}
        />
      )}
      <TrackList
        tracks={filtered}
        playlists={playlists}
        onAddToPlaylist={onAddToPlaylist}
        onEdit={onEdit}
        onEditMany={onEditMany}
        onDelete={onDelete}
        onDeleteMany={onDeleteMany}
        emptyMessage={tracks.length === 0 ? 'No tracks yet. Upload some audio files to get started.' : 'No matches.'}
      />
    </section>
  );
}
