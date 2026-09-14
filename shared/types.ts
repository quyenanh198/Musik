export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  /** Seconds. 0 when unknown. */
  duration: number;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Playlist {
  id: number;
  name: string;
  trackCount: number;
  createdAt: string;
}

export interface PlaylistDetail extends Playlist {
  tracks: Track[];
}
