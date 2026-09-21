import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.MUSIK_DATA_DIR ?? path.join(root, 'data');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST || undefined;

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}"`);
  process.exit(1);
}

const app = createApp({
  dbPath: path.join(dataDir, 'musik.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  staticDir: process.env.NODE_ENV === 'production' ? path.join(root, 'dist') : undefined,
  audioExtractUrl: process.env.AUDIOEXTRACT_URL || undefined,
});

const onListening = () => console.log(`Musik listening on http://${host ?? 'localhost'}:${port}`);
const server = host ? app.listen(port, host, onListening) : app.listen(port, onListening);

const SHUTDOWN_GRACE_MS = 5_000;
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  // Idle keep-alive sockets go now; a song still streaming gets a few seconds, then is cut so the process can exit
  // before the container runtime kills it (which would skip closing the database).
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
