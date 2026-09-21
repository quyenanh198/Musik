import express, { type ErrorRequestHandler } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { HttpError } from './errors.js';
import { tracksRouter } from './routes/tracks.js';
import { playlistsRouter } from './routes/playlists.js';
import { importsRouter } from './routes/imports.js';
import { createAudioExtractClient } from './audioextract.js';

export interface AppOptions {
  dbPath: string;
  uploadDir: string;
  /** Directory of the built client. When set, it is served as the SPA. */
  staticDir?: string;
  /** AudioExtract server to import finished downloads from; the feature is hidden when unset. */
  audioExtractUrl?: string;
  /** Maximum bytes accepted for one AudioExtract import. */
  audioExtractMaxBytes?: number;
  /** How long AudioExtract may stay silent before a request or a download is given up. Default 30 s. */
  audioExtractTimeoutMs?: number;
}

/**
 * Served with the built client. Scripts and styles come from this origin only (the theme bootstrap is a file, not
 * inline), so an injected `<script>` has nothing to run; inline `style=` attributes are what React needs.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function createApp({ dbPath, uploadDir, staticDir, audioExtractUrl, audioExtractMaxBytes, audioExtractTimeoutMs }: AppOptions) {
  mkdirSync(uploadDir, { recursive: true });
  const db = openDb(dbPath);

  const app = express();
  app.disable('x-powered-by');
  let closed = false;
  app.locals.close = () => {
    if (closed) return;
    closed = true;
    db.close();
  };

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (staticDir) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  // For load balancers, Docker HEALTHCHECK and uptime monitors: proves the process is up and the database answers.
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  // One client for both routers: imports pull files in, tracks push renames back.
  const audioExtract = createAudioExtractClient(audioExtractUrl, { timeoutMs: audioExtractTimeoutMs });
  app.use('/api/tracks', tracksRouter(db, uploadDir, audioExtract));
  app.use('/api/playlists', playlistsRouter(db));
  app.use('/api/import', importsRouter(db, uploadDir, { audioExtract, maxBytes: audioExtractMaxBytes }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (staticDir) {
    // Built assets carry a content hash in their name, so they can be cached for good; index.html and sw.js must not be.
    app.use(
      express.static(staticDir, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; type?: unknown; code?: unknown; expose?: unknown; message?: unknown };
    // multer
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large' });
      return;
    }
    if (typeof e.code === 'string' && e.code.startsWith('LIMIT_')) {
      res.status(400).json({ error: String(e.message) });
      return;
    }
    // body-parser and other http-errors: the client's mistake, so say so instead of a 500.
    const status = Number(e.status ?? e.statusCode);
    if (status >= 400 && status < 500) {
      const error =
        e.type === 'entity.parse.failed' ? 'Request body is not valid JSON'
        : e.type === 'entity.too.large' ? 'Request body is too large'
        : e.expose === true && typeof e.message === 'string' ? e.message
        : 'Bad request';
      res.status(status).json({ error });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
