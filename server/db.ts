import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
`;

export type Db = DatabaseSync;

// Columns added after the first release; applied to older databases on open.
const MIGRATIONS: Array<[column: string, ddl: string]> = [
  ['year', 'ALTER TABLE tracks ADD COLUMN year INTEGER'],
  ['genre', "ALTER TABLE tracks ADD COLUMN genre TEXT NOT NULL DEFAULT ''"],
  ['cover', 'ALTER TABLE tracks ADD COLUMN cover TEXT'],
];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  const have = new Set((db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[]).map((c) => c.name));
  for (const [column, ddl] of MIGRATIONS) if (!have.has(column)) db.exec(ddl);
  return db;
}

export const TRACK_COLUMNS = `
  id, title, artist, album, year, genre, cover, duration,
  mime_type AS mimeType, size, created_at AS createdAt
`;
