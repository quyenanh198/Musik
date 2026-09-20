export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  /** Cover image file name (null when none); fetch via /api/tracks/:id/cover. */
  cover: string | null;
  /** Which app this track was imported from ('audioextract'), or null when uploaded here. */
  sourceApp: string | null;
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
