# Musik

Self-hosted web music player with a responsive, minimalist interface. Upload audio, edit metadata and cover art, organise tracks into playlists, and keep listening while the tab is in the background.

## Features

- Responsive desktop and mobile layouts
- Light, dark, and system themes with a saved preference
- Track uploads with audio-content validation and a 200 MB per-file limit
- Title, artist, album, year, genre, and cover-art editing, including bulk actions
- Ordered playlists, search, shuffle, repeat, volume, seeking, and sleep timer
- Media Session support for lock-screen and headset controls
- Optional imports from an AudioExtract server
- Installable Progressive Web App
- Local SQLite database and file storage—no external database required

## Technology

- **Server:** Node 22, Express 5, SQLite through the built-in `node:sqlite` module
- **Client:** React 19, Vite 7, TypeScript
- **Storage:** one local folder, `./data` by default

## Requirements

Node.js **22.13 or newer**.

## Development

```bash
npm install
npm run dev        # API on :3000, Vite client on :5173
npm test           # API and preference tests
npm run build      # typecheck and build the production client
```

## Production

```bash
git clone https://github.com/quyenanh198/Musik.git
cd Musik
npm ci
npm test
npm run build
npm start          # http://localhost:3000
```

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `MUSIK_DATA_DIR` | `./data` | Folder containing `musik.db` and `uploads/` |
| `AUDIOEXTRACT_URL` | unset | Optional AudioExtract base URL, such as `http://audioextract:3000` |

Example:

```bash
MUSIK_DATA_DIR=/Volumes/Music/musik PORT=8080 npm start
```

Other devices on the trusted local network can open `http://<server-ip>:3000`.

### Auto-start with launchd on macOS

After `npm ci && npm run build`:

```bash
sh deploy/install-launchd.sh
```

The installer creates `~/Library/LaunchAgents/com.musik.server.plist`, starts the service at login, restarts it after crashes, and writes logs to `~/Library/Logs/musik.log`. Edit the plist to change `PORT`, `MUSIK_DATA_DIR`, or add `AUDIOEXTRACT_URL`, then rerun the installer.

```bash
launchctl kickstart -k gui/$(id -u)/com.musik.server   # restart
launchctl bootout gui/$(id -u)/com.musik.server        # stop and unload
```

A LaunchAgent runs only while its user is logged in.

### Docker

```bash
docker build -t musik .
docker run --rm -p 3000:3000 -v musik-data:/data musik
```

To enable AudioExtract, place both services on the same Docker network and provide `AUDIOEXTRACT_URL` to the Musik container.

## Data and security

- Back up the configured data folder; it contains the database and uploaded media.
- Musik validates uploaded and imported file contents instead of relying only on browser-provided MIME types.
- AudioExtract downloads have a 30-second request timeout and a 200 MB per-file limit.
- The server has no built-in authentication. Keep it on a trusted network or place it behind an authenticated reverse proxy before exposing it publicly.
- Shutdown signals close the HTTP server and SQLite connection cleanly.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/tracks` | List tracks |
| `POST` | `/api/tracks` | Upload the multipart `file` field |
| `PATCH` | `/api/tracks` | Update metadata for multiple tracks |
| `POST` | `/api/tracks/delete` | Delete multiple tracks |
| `POST` | `/api/tracks/cover` | Apply one cover to multiple tracks |
| `GET` | `/api/tracks/:id` | Track details |
| `PATCH` | `/api/tracks/:id` | Update editable track metadata |
| `DELETE` | `/api/tracks/:id` | Delete a track and its file |
| `GET` | `/api/tracks/:id/stream` | Stream audio with Range support |
| `GET` | `/api/tracks/:id/cover` | Get the track cover |
| `POST` | `/api/tracks/:id/cover` | Replace the track cover |
| `DELETE` | `/api/tracks/:id/cover` | Remove the track cover |
| `GET` | `/api/playlists` | List playlists |
| `POST` | `/api/playlists` | Create a playlist with `{ name }` |
| `GET` | `/api/playlists/:id` | Get a playlist and its ordered tracks |
| `PATCH` | `/api/playlists/:id` | Rename a playlist |
| `DELETE` | `/api/playlists/:id` | Delete a playlist while retaining its tracks |
| `POST` | `/api/playlists/:id/tracks` | Append one or more tracks |
| `POST` | `/api/playlists/:id/tracks/remove` | Remove multiple tracks |
| `DELETE` | `/api/playlists/:id/tracks/:trackId` | Remove one track |
| `GET` | `/api/import/sources` | List configured import sources |
| `GET` | `/api/import/audioextract` | List completed AudioExtract files |
| `POST` | `/api/import/audioextract` | Import selected AudioExtract files |

## Deployment checklist

```bash
git pull
npm ci
npm test
npm run build
npm audit
```

Restart the service only after all commands succeed. See [`HANDOFF.md`](HANDOFF.md) for the completed implementation and verification record.

## CI

`.github/workflows/ci.yml` installs dependencies, runs tests and the production build on every push and pull request, then uploads `dist/` as the `musik-dist` artifact.
