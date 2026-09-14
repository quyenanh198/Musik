# Musik

Self-hosted web music player. Upload your audio files, organise them into playlists, and keep listening while the tab is in the background (lock-screen / headset controls via the Media Session API, installable as a PWA).

- **Server:** Node 22, Express 5, SQLite (built-in `node:sqlite`, no native deps)
- **Client:** React 19, Vite 7, TypeScript
- **Storage:** everything lives in one local folder (`./data` by default)

## Requirements

Node.js **22.13 or newer** (uses the built-in `node:sqlite` module).

## Development

```bash
npm install
npm run dev        # API on :3000, Vite dev server on :5173 (proxies /api)
npm test           # API tests (vitest + supertest)
npm run build      # typecheck server + client, build client into dist/
```

## Running on a Mac mini (or any always-on machine)

```bash
git clone https://github.com/quyenanh198/Musik.git
cd Musik
npm ci
npm run build
npm start          # serves API + built client on http://localhost:3000
```

Data (SQLite database + uploaded audio) is stored locally. Configure with environment variables:

| Variable         | Default   | Description                                   |
| ---------------- | --------- | --------------------------------------------- |
| `PORT`           | `3000`    | HTTP port                                     |
| `MUSIK_DATA_DIR` | `./data`  | Folder for `musik.db` and `uploads/`          |

Example: `MUSIK_DATA_DIR=/Volumes/Music/musik PORT=8080 npm start`

Back up by copying the data folder. Other devices on your LAN can use the player at `http://<mac-mini-ip>:3000`.

## API

| Method   | Path                                        | Description                                |
| -------- | ------------------------------------------- | ------------------------------------------ |
| `GET`    | `/api/tracks`                               | List tracks                                |
| `POST`   | `/api/tracks`                               | Upload (multipart field `file`, audio/\*)  |
| `GET`    | `/api/tracks/:id`                           | Track details                              |
| `PATCH`  | `/api/tracks/:id`                           | Update `title` / `artist` / `album`        |
| `DELETE` | `/api/tracks/:id`                           | Delete track and its file                  |
| `GET`    | `/api/tracks/:id/stream`                    | Audio stream (supports `Range`)            |
| `GET`    | `/api/playlists`                            | List playlists                             |
| `POST`   | `/api/playlists`                            | Create (`{ name }`)                        |
| `GET`    | `/api/playlists/:id`                        | Playlist with ordered tracks               |
| `PATCH`  | `/api/playlists/:id`                        | Rename (`{ name }`)                        |
| `DELETE` | `/api/playlists/:id`                        | Delete playlist (tracks are kept)          |
| `POST`   | `/api/playlists/:id/tracks`                 | Append track (`{ trackId }`)               |
| `DELETE` | `/api/playlists/:id/tracks/:trackId`        | Remove track from playlist                 |

## CI

`.github/workflows/ci.yml` runs tests and the build on every push / pull request and uploads `dist/` as the `musik-dist` artifact.
