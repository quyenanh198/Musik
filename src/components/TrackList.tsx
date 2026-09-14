import { useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import { formatDuration } from '../api';
import { usePlayer } from '../player/PlayerProvider';

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: number, track: Track) => void;
  onEdit: (track: Track, patch: Pick<Track, 'title' | 'artist' | 'album'>) => Promise<void>;
  onDelete: (track: Track) => void;
  /** Shown as a "remove" action when set (e.g. remove from playlist). */
  onRemove?: (track: Track) => void;
  emptyMessage: string;
}

export function TrackList({ tracks, playlists, onAddToPlaylist, onEdit, onDelete, onRemove, emptyMessage }: Props) {
  const player = usePlayer();
  const [editing, setEditing] = useState<number | null>(null);

  if (tracks.length === 0) return <p className="muted">{emptyMessage}</p>;

  return (
    <table className="tracks">
      <thead>
        <tr>
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
            <tr key={track.id} className={isCurrent ? 'tracks__row tracks__row--current' : 'tracks__row'}>
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
                      if (e.target.value) onAddToPlaylist(Number(e.target.value), track);
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
