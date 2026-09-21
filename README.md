<p align="center"><img src="public/logo.svg" alt="Musik" width="180"></p>

# Musik

Self-hosted web music player with a responsive, minimalist interface. Upload audio, edit metadata and cover art, organise tracks into playlists, and keep listening while the tab is in the background.

## Features

- Responsive desktop and mobile layouts with clean vector SVG iconography
- Immersive Now Playing sheet with dynamic ambient album art backdrop illumination
- Animated equalizer playback indicator on active tracks with progressive disclosure controls
- Seamless audio pre-buffering that eliminates inter-track latency
- Accent-tolerant & diacritic-insensitive search matching (e.g. Vietnamese diacritics, case-insensitive)
- Light, dark, and system themes, English and Vietnamese (follows the browser, switchable), both remembered
- Track uploads by button or by dropping files anywhere on the page, with live progress; audio-content validation and a 200 MB per-file limit
- Title, artist, album, year, genre, and cover-art editing, including bulk actions
- Library sorting (date added, title, artist, album, year, length) that is remembered
- Ordered playlists you can reorder, search, shuffle (and back to the original order), repeat, volume, mute, seeking, and sleep timer
- Picks up where it left off: the queue, position, shuffle and repeat survive a reload
- Keyboard shortcuts and Media Session support for lock-screen and headset controls
- Optional imports from an AudioExtract server
- Installable Progressive Web App that opens offline (the library needs the server)
- Local SQLite database and file storage—no external database required
- Product audit & design roadmap documented in [`AUDIT.md`](AUDIT.md) and [`HANDOFF.md`](HANDOFF.md)

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek 5 seconds back / forward |
| `Shift+←` / `Shift+→`, `P` / `N` | Previous / next track |
| `M` | Mute |
| `/` | Focus the search box |

Shortcuts never fire while typing, inside a dialog, or on a button you reached with the keyboard.

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
npm test           # API, player-logic, sorting, i18n and preference tests
npm run lint       # ESLint, including the React hooks rules
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
| `HOST` | all interfaces | Address to listen on, e.g. `127.0.0.1` behind a reverse proxy |
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

The image runs as the unprivileged `node` user and has a `HEALTHCHECK` (`GET /api/health`). A **new** volume works as is. A volume created by an earlier version of the image is owned by root and must be handed over once, or Musik cannot open its database:

```bash
docker run --rm -v musik-data:/data alpine chown -R 1000:1000 /data
```

## Data and security

- Back up the configured data folder; it contains the database and uploaded media.
- Musik validates uploaded and imported file contents instead of relying only on browser-provided MIME types; cover images are checked by their bytes too, and stored file extensions are restricted.
- AudioExtract downloads stop after 30 seconds of silence (not 30 seconds in total, so large files finish), have a 200 MB per-file limit, and only accept relative paths inside the remote's files route.
- Requests are validated: ids must be real ids, text fields have length limits, JSON bodies are capped at 256 KB, and malformed input is a `4xx`, never a `500`.
- In production the client is served with a Content-Security-Policy (scripts and styles from this origin only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a same-origin referrer policy.
- The server has no built-in authentication. Keep it on a trusted network or place it behind an authenticated reverse proxy before exposing it publicly.
- Shutdown signals close the HTTP server and SQLite connection cleanly.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness and database check (used by the Docker `HEALTHCHECK`) |
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
| `POST` | `/api/playlists/:id/tracks/move` | Move one track: `{ trackId, toIndex }` |
| `DELETE` | `/api/playlists/:id/tracks/:trackId` | Remove one track |
| `GET` | `/api/import/sources` | List configured import sources |
| `GET` | `/api/import/audioextract` | List completed AudioExtract files |
| `POST` | `/api/import/audioextract` | Import selected AudioExtract files |

## Deployment checklist

```bash
git pull
npm ci
npm run lint
npm test
npm run build
npm audit
```

Restart the service only after all commands succeed. See [`HANDOFF.md`](HANDOFF.md) for the completed implementation and verification record.

## CI

`.github/workflows/ci.yml` installs dependencies, then runs lint, tests, the production build and `npm audit` for shipped dependencies on every push and pull request, and uploads `dist/` as the `musik-dist` artifact. A second job checks that the Docker image builds.
