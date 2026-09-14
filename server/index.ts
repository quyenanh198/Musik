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
});

app.listen(port, () => {
  console.log(`Musik listening on http://localhost:${port}`);
});
