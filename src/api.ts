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
  updateTrack: (id: number, patch: Partial<Pick<Track, 'title' | 'artist' | 'album'>>) =>
    request<Track>(`/api/tracks/${id}`, json('PATCH', patch)),
  deleteTrack: (id: number) => request<void>(`/api/tracks/${id}`, { method: 'DELETE' }),
  streamUrl: (id: number) => `/api/tracks/${id}/stream`,

  listPlaylists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string) => request<PlaylistDetail>('/api/playlists', json('POST', { name })),
  getPlaylist: (id: number) => request<PlaylistDetail>(`/api/playlists/${id}`),
  renamePlaylist: (id: number, name: string) => request<PlaylistDetail>(`/api/playlists/${id}`, json('PATCH', { name })),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (playlistId: number, trackId: number) =>
    request<PlaylistDetail>(`/api/playlists/${playlistId}/tracks`, json('POST', { trackId })),
  removeFromPlaylist: (playlistId: number, trackId: number) =>
    request<void>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' }),
};

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
