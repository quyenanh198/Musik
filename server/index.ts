import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.MUSIK_DATA_DIR ?? path.join(root, 'data');
const port = Number(process.env.PORT ?? 3000);

const app = createApp({
  dbPath: path.join(dataDir, 'musik.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  staticDir: process.env.NODE_ENV === 'production' ? path.join(root, 'dist') : undefined,
  audioExtractUrl: process.env.AUDIOEXTRACT_URL || undefined,
});

const server = app.listen(port, () => {
  console.log(`Musik listening on http://localhost:${port}`);
});

const shutdown = () => {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
