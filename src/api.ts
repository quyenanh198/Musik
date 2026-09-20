import type { Playlist, PlaylistDetail, Track } from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // Non-JSON error body: keep statusText.
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listTracks: () => request<Track[]>('/api/tracks'),
  uploadTrack: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Track>('/api/tracks', { method: 'POST', body: form });
  },
  updateTrack: (id: number, patch: TrackPatch) => request<Track>(`/api/tracks/${id}`, json('PATCH', patch)),
  uploadCover: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Track>(`/api/tracks/${id}/cover`, { method: 'POST', body: form });
  },
  deleteCover: (id: number) => request<Track>(`/api/tracks/${id}/cover`, { method: 'DELETE' }),
  /** One image for many tracks (album art). */
  setCoverMany: (ids: number[], file: File) => {
    const form = new FormData();
    form.append('ids', JSON.stringify(ids));
    form.append('file', file);
    return request<Track[]>('/api/tracks/cover', { method: 'POST', body: form });
  },
  coverUrl: (track: Pick<Track, 'id' | 'cover'>) => (track.cover ? `/api/tracks/${track.id}/cover?v=${encodeURIComponent(track.cover)}` : null),
  deleteTrack: (id: number) => request<void>(`/api/tracks/${id}`, { method: 'DELETE' }),
  /** Same patch applied to many tracks; only the fields present are changed. */
  updateTracks: (ids: number[], patch: TrackPatch) => request<Track[]>('/api/tracks', json('PATCH', { ids, patch })),
  deleteTracks: (ids: number[]) => request<{ deleted: number }>('/api/tracks/delete', json('POST', { ids })),
  streamUrl: (id: number) => `/api/tracks/${id}/stream`,

  listPlaylists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string) => request<PlaylistDetail>('/api/playlists', json('POST', { name })),
  getPlaylist: (id: number) => request<PlaylistDetail>(`/api/playlists/${id}`),
  renamePlaylist: (id: number, name: string) => request<PlaylistDetail>(`/api/playlists/${id}`, json('PATCH', { name })),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  /** One request adds every id, in order; ids already in the playlist are skipped. */
  addToPlaylist: (playlistId: number, trackIds: number[]) =>
    request<PlaylistDetail>(`/api/playlists/${playlistId}/tracks`, json('POST', { trackIds })),
  removeFromPlaylist: (playlistId: number, trackId: number) =>
    request<void>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' }),
  removeManyFromPlaylist: (playlistId: number, trackIds: number[]) =>
    request<PlaylistDetail & { removed: number }>(`/api/playlists/${playlistId}/tracks/remove`, json('POST', { trackIds })),

  /** Which external sources the server can import from (AudioExtract results). */
  importSources: () => request<{ audioextract: boolean }>('/api/import/sources'),
  listAudioExtract: () => request<RemoteFile[]>('/api/import/audioextract'),
  /** `title` overrides the tag/filename for that import. */
  importFromAudioExtract: (items: { path: string; title?: string }[], playlistId?: number) =>
    request<ImportResult>(
      '/api/import/audioextract',
      json('POST', { items, playlistId: playlistId ?? null }),
    ),
};

/** Editable tag fields; `year: null` clears it. */
export type TrackPatch = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre' | 'year'>>;

export interface RemoteFile {
  path: string;
  name: string;
  size: number;
  updatedAt: string;
  /** Set when this file is already in the library — importing it again is refused. */
  trackId: number | null;
  /** The title that track carries now. */
  title: string | null;
}

export interface ImportResult {
  imported: Track[];
  failed: { path: string; error: string }[];
  /** Files left alone because the library already has them. */
  skipped: { path: string; trackId: number; title: string }[];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
