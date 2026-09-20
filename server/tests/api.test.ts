import { fixFilename } from '../routes/tracks.js';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { makeWav } from './wav.js';

let dir: string;
let app: ReturnType<typeof createApp>;
let apps: ReturnType<typeof createApp>[];

const makeApp = (options: Parameters<typeof createApp>[0]) => {
  const created = createApp(options);
  apps.push(created);
  return created;
};

beforeEach(() => {
  apps = [];
  dir = mkdtempSync(path.join(tmpdir(), 'musik-'));
  app = makeApp({ dbPath: path.join(dir, 'test.db'), uploadDir: path.join(dir, 'uploads') });
});

afterEach(() => {
  apps.forEach((created) => created.locals.close());
  rmSync(dir, { recursive: true, force: true });
});

const uploadTrack = (name = 'song.wav', seconds = 2) =>
  request(app).post('/api/tracks').attach('file', makeWav(seconds), { filename: name, contentType: 'audio/wav' });

describe('tracks', () => {
  it('starts empty', async () => {
    const res = await request(app).get('/api/tracks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('uploads a track and derives metadata', async () => {
    const res = await uploadTrack('My Song.wav', 2);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'My Song', artist: '', album: '', mimeType: 'audio/wav' });
    expect(res.body.duration).toBeCloseTo(2, 1);
    expect(res.body.size).toBe(makeWav(2).length);

    const list = await request(app).get('/api/tracks');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(res.body.id);
  });

  it('rejects non-audio uploads', async () => {
    const res = await request(app)
      .post('/api/tracks')
      .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(readdirSync(path.join(dir, 'uploads'))).toEqual([]);
  });

  it('rejects files whose bytes are not audio despite an audio MIME type', async () => {
    const res = await request(app)
      .post('/api/tracks')
      .attach('file', Buffer.from('not actually audio'), { filename: 'fake.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(415);
    expect(readdirSync(path.join(dir, 'uploads'))).toEqual([]);
  });

  it('rejects a missing file', async () => {
    const res = await request(app).post('/api/tracks');
    expect(res.status).toBe(400);
  });

  it('updates title/artist/album', async () => {
    const { body: track } = await uploadTrack();
    const res = await request(app)
      .patch(`/api/tracks/${track.id}`)
      .send({ title: '  New  ', artist: 'Someone', album: 'LP' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'New', artist: 'Someone', album: 'LP' });
  });

  it('ignores an empty title on update', async () => {
    const { body: track } = await uploadTrack('Keep.wav');
    const res = await request(app).patch(`/api/tracks/${track.id}`).send({ title: '   ' });
    expect(res.body.title).toBe('Keep');
  });

  it('streams with Range support', async () => {
    const { body: track } = await uploadTrack();
    const full = await request(app).get(`/api/tracks/${track.id}/stream`);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('audio/wav');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Number(full.headers['content-length'])).toBe(track.size);

    const partial = await request(app).get(`/api/tracks/${track.id}/stream`).set('Range', 'bytes=0-9');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-9/${track.size}`);
    expect(partial.body.length).toBe(10);
  });

  it('deletes a track and its file', async () => {
    const { body: track } = await uploadTrack();
    expect(readdirSync(path.join(dir, 'uploads'))).toHaveLength(1);

    const res = await request(app).delete(`/api/tracks/${track.id}`);
    expect(res.status).toBe(204);
    expect(readdirSync(path.join(dir, 'uploads'))).toHaveLength(0);
    expect((await request(app).get(`/api/tracks/${track.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/tracks/${track.id}/stream`)).status).toBe(404);
  });

  it('404s for unknown ids', async () => {
    expect((await request(app).get('/api/tracks/999')).status).toBe(404);
    expect((await request(app).patch('/api/tracks/999').send({ title: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/tracks/999')).status).toBe(404);
  });
});

describe('playlists', () => {
  it('creates, lists, renames and deletes', async () => {
    const created = await request(app).post('/api/playlists').send({ name: ' Chill ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Chill', trackCount: 0, tracks: [] });

    const list = await request(app).get('/api/playlists');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: created.body.id, name: 'Chill', trackCount: 0 });

    const renamed = await request(app).patch(`/api/playlists/${created.body.id}`).send({ name: 'Focus' });
    expect(renamed.body.name).toBe('Focus');

    expect((await request(app).delete(`/api/playlists/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/playlists/${created.body.id}`)).status).toBe(404);
  });

  it('requires a name', async () => {
    expect((await request(app).post('/api/playlists').send({})).status).toBe(400);
    expect((await request(app).post('/api/playlists').send({ name: '  ' })).status).toBe(400);
  });

  it('adds tracks in order, dedupes, and removes', async () => {
    const a = (await uploadTrack('a.wav')).body;
    const b = (await uploadTrack('b.wav')).body;
    const playlist = (await request(app).post('/api/playlists').send({ name: 'P' })).body;
    const url = `/api/playlists/${playlist.id}/tracks`;

    expect((await request(app).post(url).send({ trackId: b.id })).status).toBe(201);
    expect((await request(app).post(url).send({ trackId: a.id })).status).toBe(201);
    // Adding the same track again is a no-op.
    expect((await request(app).post(url).send({ trackId: b.id })).status).toBe(201);

    let detail = (await request(app).get(`/api/playlists/${playlist.id}`)).body;
    expect(detail.trackCount).toBe(2);
    expect(detail.tracks.map((t: { id: number }) => t.id)).toEqual([b.id, a.id]);

    expect((await request(app).delete(`${url}/${b.id}`)).status).toBe(204);
    expect((await request(app).delete(`${url}/${b.id}`)).status).toBe(404);
    detail = (await request(app).get(`/api/playlists/${playlist.id}`)).body;
    expect(detail.tracks.map((t: { id: number }) => t.id)).toEqual([a.id]);
  });

  it('validates track ids when adding', async () => {
    const playlist = (await request(app).post('/api/playlists').send({ name: 'P' })).body;
    const url = `/api/playlists/${playlist.id}/tracks`;
    expect((await request(app).post(url).send({})).status).toBe(400);
    expect((await request(app).post(url).send({ trackId: 999 })).status).toBe(404);
    expect((await request(app).post('/api/playlists/999/tracks').send({ trackId: 1 })).status).toBe(404);
  });

  it('drops playlist entries when a track is deleted', async () => {
    const a = (await uploadTrack('a.wav')).body;
    const playlist = (await request(app).post('/api/playlists').send({ name: 'P' })).body;
    await request(app).post(`/api/playlists/${playlist.id}/tracks`).send({ trackId: a.id });
    await request(app).delete(`/api/tracks/${a.id}`);
    const detail = (await request(app).get(`/api/playlists/${playlist.id}`)).body;
    expect(detail.trackCount).toBe(0);
    expect(detail.tracks).toEqual([]);
  });
});

describe('misc', () => {
  it('404s unknown api routes as json', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('creates the upload dir', () => {
    expect(existsSync(path.join(dir, 'uploads'))).toBe(true);
  });
});

describe('fixFilename', () => {
  it('re-decodes UTF-8 filenames that multer read as latin1', () => {
    const utf8 = 'Chuyện hoài tấn gác bấng.mp3';
    const mangled = Buffer.from(utf8, 'utf8').toString('latin1');
    expect(fixFilename(mangled)).toBe(utf8);
  });
  it('leaves plain ASCII and genuine latin1 names alone', () => {
    expect(fixFilename('song.mp3')).toBe('song.mp3');
    expect(fixFilename('caf\u00e9.mp3')).toBe('caf\u00e9.mp3');
  });
});

describe('batch operations', () => {
  const upload3 = async () => {
    const a = (await uploadTrack('a.wav')).body;
    const b = (await uploadTrack('b.wav')).body;
    const c = (await uploadTrack('c.wav')).body;
    return [a, b, c] as Array<{ id: number }>;
  };

  it('adds many tracks to a playlist in one request, in order, skipping duplicates', async () => {
    const [a, b, c] = await upload3();
    const { body: pl } = await request(app).post('/api/playlists').send({ name: 'Mix' });
    const res = await request(app).post(`/api/playlists/${pl.id}/tracks`).send({ trackIds: [c.id, a.id, c.id] });
    expect(res.status).toBe(201);
    expect(res.body.tracks.map((t: { id: number }) => t.id)).toEqual([c.id, a.id]);
    const again = await request(app).post(`/api/playlists/${pl.id}/tracks`).send({ trackIds: [a.id, b.id] });
    expect(again.body.tracks.map((t: { id: number }) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('rejects a batch containing an unknown track', async () => {
    const [a] = await upload3();
    const { body: pl } = await request(app).post('/api/playlists').send({ name: 'Mix' });
    const res = await request(app).post(`/api/playlists/${pl.id}/tracks`).send({ trackIds: [a.id, 9999] });
    expect(res.status).toBe(404);
    const detail = await request(app).get(`/api/playlists/${pl.id}`);
    expect(detail.body.tracks).toEqual([]);
  });

  it('removes many tracks from a playlist in one request', async () => {
    const [a, b, c] = await upload3();
    const { body: pl } = await request(app).post('/api/playlists').send({ name: 'Mix' });
    await request(app).post(`/api/playlists/${pl.id}/tracks`).send({ trackIds: [a.id, b.id, c.id] });
    const res = await request(app).post(`/api/playlists/${pl.id}/tracks/remove`).send({ trackIds: [a.id, c.id, 12345] });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);
    expect(res.body.tracks.map((t: { id: number }) => t.id)).toEqual([b.id]);
  });

  it('bulk-edits artist/album without touching titles', async () => {
    const [a, b, c] = await upload3();
    const res = await request(app).patch('/api/tracks').send({ ids: [a.id, b.id], patch: { artist: 'Trịnh Công Sơn', album: ' Sơn ca 7 ' } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const t of res.body) expect(t).toMatchObject({ artist: 'Trịnh Công Sơn', album: 'Sơn ca 7' });
    expect(res.body.map((t: { title: string }) => t.title).sort()).toEqual(['a', 'b']);
    const untouched = await request(app).get(`/api/tracks/${c.id}`);
    expect(untouched.body.artist).toBe('');
  });

  it('rejects a bulk edit with nothing to change', async () => {
    const [a] = await upload3();
    const res = await request(app).patch('/api/tracks').send({ ids: [a.id], patch: {} });
    expect(res.status).toBe(400);
  });

  it('bulk-deletes tracks and their files', async () => {
    const [a, b, c] = await upload3();
    const res = await request(app).post('/api/tracks/delete').send({ ids: [a.id, c.id, 777] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    const list = await request(app).get('/api/tracks');
    expect(list.body.map((t: { id: number }) => t.id)).toEqual([b.id]);
    expect(readdirSync(path.join(dir, 'uploads'))).toHaveLength(1);
  });
});

describe('import from AudioExtract', () => {
  let stub: Server;
  let stubUrl: string;

  beforeEach(async () => {
    const ae = express();
    ae.get('/api/files', (_req, res) =>
      res.json([
        { path: 't1/Bài hát.wav', name: 'Bài hát.wav', size: makeWav(1).length, updatedAt: '2026-01-01T00:00:00.000Z' },
        { path: 't2/notes.txt', name: 'notes.txt', size: 5, updatedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );
    ae.get('/api/files/t1/B%C3%A0i%20h%C3%A1t.wav', (_req, res) => res.type('audio/wav').send(makeWav(1)));
    ae.get('/api/files/t2/notes.txt', (_req, res) => res.type('text/plain').send('hello'));
    ae.get('/api/files/huge.wav', (_req, res) => {
      res.type('audio/wav').send(makeWav(2));
    });
    await new Promise<void>((resolve) => {
      stub = ae.listen(0, '127.0.0.1', () => resolve());
    });
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    app = makeApp({
      dbPath: path.join(dir, 'test2.db'),
      uploadDir: path.join(dir, 'uploads2'),
      audioExtractUrl: stubUrl,
      audioExtractMaxBytes: makeWav(1).length + 10,
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  it('reports the source only when configured', async () => {
    expect((await request(app).get('/api/import/sources')).body).toEqual({ audioextract: true });
    const bare = makeApp({ dbPath: path.join(dir, 'bare.db'), uploadDir: path.join(dir, 'uploads3') });
    expect((await request(bare).get('/api/import/sources')).body).toEqual({ audioextract: false });
    expect((await request(bare).get('/api/import/audioextract')).status).toBe(404);
  });

  it('lists remote files', async () => {
    const res = await request(app).get('/api/import/audioextract');
    expect(res.status).toBe(200);
    expect(res.body.map((f: { name: string }) => f.name)).toEqual(['Bài hát.wav', 'notes.txt']);
  });

  it('copies chosen files into the library and a playlist, skipping non-audio', async () => {
    const { body: pl } = await request(app).post('/api/playlists').send({ name: 'Imported' });
    const res = await request(app)
      .post('/api/import/audioextract')
      .send({ paths: ['t1/Bài hát.wav', 't2/notes.txt', 'missing/x.wav'], playlistId: pl.id });
    expect(res.status).toBe(201);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0]).toMatchObject({ title: 'Bài hát', mimeType: 'audio/wav' });
    expect(res.body.imported[0].duration).toBeCloseTo(1, 1);
    expect(res.body.failed.map((f: { path: string }) => f.path)).toEqual(['t2/notes.txt', 'missing/x.wav']);
    expect(readdirSync(path.join(dir, 'uploads2'))).toHaveLength(1);

    const detail = await request(app).get(`/api/playlists/${pl.id}`);
    expect(detail.body.tracks.map((t: { id: number }) => t.id)).toEqual([res.body.imported[0].id]);
    const stream = await request(app).get(`/api/tracks/${res.body.imported[0].id}/stream`);
    expect(stream.status).toBe(200);
  });

  it('rejects an empty selection', async () => {
    expect((await request(app).post('/api/import/audioextract').send({ paths: [] })).status).toBe(400);
  });

  it('rejects a remote file larger than the import limit', async () => {
    const res = await request(app).post('/api/import/audioextract').send({ paths: ['huge.wav'] });
    expect(res.status).toBe(502);
    expect(res.body.failed[0].error).toContain('too large');
    expect(readdirSync(path.join(dir, 'uploads2'))).toEqual([]);
  });

  it('lets the caller pick the title while importing', async () => {
    const res = await request(app)
      .post('/api/import/audioextract')
      .send({ items: [{ path: 't1/Bài hát.wav', title: '  Bài hát (bản chuẩn)  ' }, { path: 't1/Bài hát.wav', title: 'dup' }] });
    expect(res.status).toBe(201);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0].title).toBe('Bài hát (bản chuẩn)');
  });
});

describe('metadata: year, genre, cover', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  it('edits year and genre, single and bulk', async () => {
    const { body: a } = await uploadTrack('a.wav');
    const { body: b } = await uploadTrack('b.wav');
    expect(a).toMatchObject({ year: null, genre: '', cover: null });
    const one = await request(app).patch(`/api/tracks/${a.id}`).send({ year: '1999', genre: ' Pop ' });
    expect(one.body).toMatchObject({ year: 1999, genre: 'Pop' });
    expect((await request(app).patch(`/api/tracks/${a.id}`).send({ year: 'abc' })).status).toBe(400);
    const many = await request(app).patch('/api/tracks').send({ ids: [a.id, b.id], patch: { genre: 'Rock', year: null } });
    expect(many.body.map((t: { genre: string; year: number | null }) => [t.genre, t.year])).toEqual([['Rock', null], ['Rock', null]]);
  });

  it('uploads, serves and removes a cover', async () => {
    const { body: t } = await uploadTrack('c.wav');
    expect((await request(app).get(`/api/tracks/${t.id}/cover`)).status).toBe(404);
    const up = await request(app).post(`/api/tracks/${t.id}/cover`).attach('file', png, { filename: 'c.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    expect(up.body.cover).toMatch(/\.png$/);
    const got = await request(app).get(`/api/tracks/${t.id}/cover`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toMatch(/image\/png/);
    expect(readdirSync(path.join(dir, 'uploads', 'covers'))).toHaveLength(1);
    const bad = await request(app).post(`/api/tracks/${t.id}/cover`).attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(415);
    const del = await request(app).delete(`/api/tracks/${t.id}/cover`);
    expect(del.body.cover).toBeNull();
    expect(readdirSync(path.join(dir, 'uploads', 'covers'))).toHaveLength(0);
  });

  it('applies one cover to many tracks and cleans up on delete', async () => {
    const { body: a } = await uploadTrack('a.wav');
    const { body: b } = await uploadTrack('b.wav');
    const res = await request(app)
      .post('/api/tracks/cover')
      .field('ids', JSON.stringify([a.id, b.id]))
      .attach('file', png, { filename: 'art.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.map((t: { cover: string | null }) => Boolean(t.cover))).toEqual([true, true]);
    expect(readdirSync(path.join(dir, 'uploads', 'covers'))).toHaveLength(2);
    await request(app).post('/api/tracks/delete').send({ ids: [a.id] });
    await request(app).delete(`/api/tracks/${b.id}`);
    expect(readdirSync(path.join(dir, 'uploads', 'covers'))).toHaveLength(0);
  });
});

describe('AudioExtract stays in step with the library', () => {
  let stub: Server;
  let files: { path: string; name: string }[];
  let renames: { path: string; name: string }[];

  beforeEach(async () => {
    files = [{ path: 't1/Bài hát.wav', name: 'Bài hát.wav' }];
    renames = [];
    const ae = express();
    ae.use(express.json());
    ae.get('/api/files', (_req, res) =>
      res.json(files.map((f) => ({ ...f, size: makeWav(1).length, updatedAt: '2026-01-01T00:00:00.000Z' }))),
    );
    ae.get(/^\/api\/files\/(.+)$/, (_req, res) => res.type('audio/wav').send(makeWav(1)));
    ae.post('/api/files/rename', (req, res) => {
      const { path: from, name } = req.body as { path: string; name: string };
      const file = files.find((f) => f.path === from);
      if (!file) return res.status(404).json({ error: 'File not found' });
      renames.push({ path: from, name });
      const ext = from.slice(from.lastIndexOf('.'));
      file.name = `${name}${ext}`;
      file.path = `${from.split('/')[0]}/${file.name}`;
      res.json({ path: file.path, name: file.name });
    });
    await new Promise<void>((resolve) => {
      stub = ae.listen(0, '127.0.0.1', () => resolve());
    });
    app = makeApp({
      dbPath: path.join(dir, 'sync.db'),
      uploadDir: path.join(dir, 'uploads-sync'),
      audioExtractUrl: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  const importAll = () =>
    request(app).post('/api/import/audioextract').send({ paths: files.map((f) => f.path) });

  it('imports a file once, then reports it as already there instead of duplicating it', async () => {
    const first = await importAll();
    expect(first.status).toBe(201);
    expect(first.body.imported).toHaveLength(1);
    const trackId = first.body.imported[0].id;
    expect(first.body.imported[0].sourceApp).toBe('audioextract');

    const again = await importAll();
    expect(again.status).toBe(200);
    expect(again.body.imported).toHaveLength(0);
    expect(again.body.failed).toHaveLength(0);
    expect(again.body.skipped).toEqual([{ path: files[0].path, trackId, title: 'Bài hát' }]);
    expect((await request(app).get('/api/tracks')).body).toHaveLength(1);

    const listed = await request(app).get('/api/import/audioextract');
    expect(listed.body[0]).toMatchObject({ trackId, title: 'Bài hát' });
  });

  it('renaming in the library renames the file in AudioExtract', async () => {
    const { body } = await importAll();
    const track = body.imported[0];

    const renamed = await request(app).patch(`/api/tracks/${track.id}`).send({ title: 'Tên mới' });
    expect(renamed.status).toBe(200);
    expect(renames).toEqual([{ path: 't1/Bài hát.wav', name: 'Tên mới' }]);
    expect(files[0].path).toBe('t1/Tên mới.wav');

    // The link survives the rename: the file is still recognised as imported.
    const listed = await request(app).get('/api/import/audioextract');
    expect(listed.body[0]).toMatchObject({ path: 't1/Tên mới.wav', trackId: track.id });
  });

  it('a rename done in AudioExtract is carried into the library', async () => {
    const { body } = await importAll();
    const track = body.imported[0];

    files[0] = { path: 't1/Đổi bên kia.wav', name: 'Đổi bên kia.wav' };
    const listed = await request(app).get('/api/import/audioextract');
    expect(listed.body[0]).toMatchObject({ trackId: track.id, title: 'Đổi bên kia' });
    expect((await request(app).get(`/api/tracks/${track.id}`)).body.title).toBe('Đổi bên kia');
  });

  it('keeps editing usable when AudioExtract is unreachable', async () => {
    const { body } = await importAll();
    await new Promise((resolve) => stub.close(resolve));
    const renamed = await request(app).patch(`/api/tracks/${body.imported[0].id}`).send({ title: 'Vẫn đổi được' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Vẫn đổi được');
    stub = express().listen(0, '127.0.0.1');
  });

  it('leaves a track uploaded here alone', async () => {
    const { body: track } = await request(app)
      .post('/api/tracks')
      .attach('file', makeWav(1), { filename: 'local.wav', contentType: 'audio/wav' });
    expect(track.sourceApp).toBeNull();
    await request(app).patch(`/api/tracks/${track.id}`).send({ title: 'Đổi tên cục bộ' });
    expect(renames).toEqual([]);
  });
});

describe('the same song arriving twice from AudioExtract', () => {
  let stub: Server;

  beforeEach(async () => {
    const ae = express();
    // Two separate results holding the same audio — what happens when a download is repeated.
    ae.get('/api/files', (_req, res) =>
      res.json([
        { path: 'a1/Bài.wav', name: 'Bài.wav', size: makeWav(1).length, updatedAt: '2026-01-01T00:00:00.000Z' },
        { path: 'a2/Bài.wav', name: 'Bài.wav', size: makeWav(1).length, updatedAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );
    ae.get(/^\/api\/files\/(.+)$/, (_req, res) => res.type('audio/wav').send(makeWav(1)));
    await new Promise<void>((resolve) => {
      stub = ae.listen(0, '127.0.0.1', () => resolve());
    });
    app = makeApp({
      dbPath: path.join(dir, 'twin.db'),
      uploadDir: path.join(dir, 'uploads-twin'),
      audioExtractUrl: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  it('keeps one track even though the two results are different files', async () => {
    const res = await request(app)
      .post('/api/import/audioextract')
      .send({ paths: ['a1/Bài.wav', 'a2/Bài.wav'] });
    expect(res.status).toBe(201);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.failed).toHaveLength(0);
    expect((await request(app).get('/api/tracks')).body).toHaveLength(1);
    // The copy that lost the race leaves nothing behind on disk.
    expect(readdirSync(path.join(dir, 'uploads-twin')).filter((f) => f.endsWith('.wav'))).toHaveLength(1);
  });
});
