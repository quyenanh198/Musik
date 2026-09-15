import express, { type ErrorRequestHandler } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { HttpError } from './errors.js';
import { tracksRouter } from './routes/tracks.js';
import { playlistsRouter } from './routes/playlists.js';
import { importsRouter } from './routes/imports.js';

export interface AppOptions {
  dbPath: string;
  uploadDir: string;
  /** Directory of the built client. When set, it is served as the SPA. */
  staticDir?: string;
  /** AudioExtract server to import finished downloads from; the feature is hidden when unset. */
  audioExtractUrl?: string;
}

export function createApp({ dbPath, uploadDir, staticDir, audioExtractUrl }: AppOptions) {
  mkdirSync(uploadDir, { recursive: true });
  const db = openDb(dbPath);

  const app = express();
  app.use(express.json());
  app.use('/api/tracks', tracksRouter(db, uploadDir));
  app.use('/api/playlists', playlistsRouter(db));
  app.use('/api/import', importsRouter(db, uploadDir, { audioExtractUrl }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
