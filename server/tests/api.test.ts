import { fixFilename } from '../routes/tracks.js';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { makeWav } from './wav.js';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'musik-'));
  app = createApp({ dbPath: path.join(dir, 'test.db'), uploadDir: path.join(dir, 'uploads') });
});

afterEach(() => {
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
