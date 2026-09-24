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

/**
 * fetch cannot report upload progress, XMLHttpRequest can. `onProgress` gets 0..1 as the bytes leave the browser.
 */
function uploadWithProgress<T>(url: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON body: fall back to the status text below.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new Error((body as { error?: string } | null)?.error ?? (xhr.statusText || `HTTP ${xhr.status}`)));
    };
    xhr.send(form);
  });
}

export type UploadedTrack = Track & { alreadyInLibrary?: boolean };

export const api = {
  listTracks: () => request<Track[]>('/api/tracks'),
  /** Bài đã có trong thư viện thì server trả lại chính bài đó kèm `alreadyInLibrary`, không thêm dòng mới. */
  uploadTrack: (file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return uploadWithProgress<UploadedTrack>('/api/tracks', form, onProgress);
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
  /** Put one track at `toIndex` (0 = first); returns the playlist in its new order. */
  moveInPlaylist: (playlistId: number, trackId: number, toIndex: number) =>
    request<PlaylistDetail>(`/api/playlists/${playlistId}/tracks/move`, json('POST', { trackId, toIndex })),

  /** Which external sources the server can import from (AudioExtract results). */
  importSources: () => request<{ audioextract: boolean }>('/api/import/sources'),
  listAudioExtract: () => request<RemoteFile[]>('/api/import/audioextract'),
  /**
   * `title` overrides the tag/filename for that import. The server answers 502 when nothing could be imported but
   * still sends the per-file reasons in the body; those are returned like any other result instead of being
   * flattened into "Bad Gateway".
   */
  importFromAudioExtract: async (items: { path: string; title?: string }[], playlistId?: number): Promise<ImportResult> => {
    const res = await fetch('/api/import/audioextract', json('POST', { items, playlistId: playlistId ?? null }));
    const body = (await res.json().catch(() => null)) as (Partial<ImportResult> & { error?: string }) | null;
    if (body && Array.isArray(body.imported) && Array.isArray(body.failed) && Array.isArray(body.skipped)) return body as ImportResult;
    throw new Error(body?.error ?? res.statusText);
  },
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
