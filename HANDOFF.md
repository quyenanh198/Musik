# Musik hand-off

Last updated: 2026-09-21

Status legend: `OPEN`, `IN PROGRESS`, `DONE`, `DEFERRED`.

| Priority | Status | Area | Work item | Completion evidence |
| --- | --- | --- | --- | --- |
| P0 | DONE | Reliability | Close SQLite connections explicitly and during shutdown; make Windows tests release temporary databases. | 34 API tests pass on Windows |
| P0 | DONE | Security | Verify uploaded and imported audio bytes rather than trusting MIME declarations. | Spoofed-audio regression test passes |
| P0 | DONE | Security | Add timeout and maximum-size enforcement to AudioExtract imports. | Oversize-import regression test passes; 30-second fetch timeout configured |
| P1 | DONE | Reliability | Remove uploaded audio/cover artifacts if parsing or database persistence fails. | Cleanup paths implemented and spoofed upload leaves an empty directory |
| P1 | DONE | Player | Normalize stored and user-supplied volume to prevent playback exceptions. | Five volume boundary tests pass |
| P1 | DONE | UI | Introduce original minimalist Musik styling inspired by modern music apps. | Production build passes; desktop render inspected |
| P1 | DONE | Themes | Add light, dark, and system modes with persisted preference and no startup flash. | Five theme normalization tests and pre-mount bootstrap pass build |
| P1 | DONE | Responsive | Support desktop and mobile navigation, library, dialogs, and player controls. | 390×844 and 1440×900 headless renders inspected |
| P1 | DONE | Accessibility | Add visible focus, 44px targets, labelled controls/dialogs, focus traps, Escape behavior, and live feedback. | Semantic/static review and production typecheck pass |
| P2 | DONE | Maintainability | Preserve valid UTF-8 text and remove the previously garbled comment sample. | UTF-8 source scan inspected |
| P2 | DONE | Dependencies | Upgrade vulnerable Vitest development tooling. | Vitest 4.1.11; `npm audit` reports zero vulnerabilities |
| P2 | DONE | Scope | Preserve AudioExtract and Lazybutts-specific integration. | No integration removal planned |

## Audit 2026-09-21 (starting commit 05d3c37) — all items resolved

Baseline before the audit: `tsc` clean (server and client), 58 tests passing, `npm audit` 0 vulnerabilities.
Result after the work: `tsc` clean, **147 tests passing** (62 server, 85 client), `npm run lint` clean, production build succeeds, `npm audit` 0 vulnerabilities (also with `--omit=dev --audit-level=high`).
Items marked "reproduced" were confirmed with a throwaway test before the fix; the regression tests that now guard them are named in the last column. The work is on branch `audit/pro-polish`.

### Bugs

| ID | Status | Area | Finding | Fix and guarding test |
| --- | --- | --- | --- | --- |
| A1 | DONE | Import | A second file from an AudioExtract folder that already had one file imported was skipped and reported with the first file's title (reproduced). | The POST duplicate check matches the exact remote path only; the twin check (title and size) still catches real duplicates. `audit.test.ts` "A1: imports every file of a folder" |
| A2 | DONE | Import / UI | A fully failed import showed only "Bad Gateway". | The client reads the per-file reasons from the 502 body; the picker stays open and lists them; a partly failed import toasts the first reason. `audit.test.ts` "A2", `importSummary.test.ts` |
| A3 | DONE | Import | The 30 s timeout also aborted the body, so downloads longer than 30 s failed (reproduced). | The timer guards only the response headers; the body is stopped by an idle watchdog (30 s of silence) or by the browser leaving. `audit.test.ts` "A3" (slow download succeeds, silent download is stopped and leaves no file) |
| A4 | DONE | Import / Security | `../../secret` escaped the remote files route (reproduced). | `isSafeRemotePath` rejects empty, `.`, `..`, absolute, backslash and control-character paths, in the client and in the import route. `audit.test.ts` "A4" |
| A5 | DONE | API | Malformed or oversized JSON returned 500 (reproduced). | The error handler maps `4xx` errors from body-parser and multer to their status and a clear message; JSON limit is 256 KB. `audit.test.ts` "A5/A6" |
| A6 | DONE | API | `PATCH /api/tracks/:id` without a body returned 500 (reproduced). | Single and bulk PATCH share one parser that treats a missing body as "nothing to change". `audit.test.ts` "A5/A6" |
| A7 | DONE | API | An empty cover upload removed the existing cover (reproduced). | Covers are verified by their bytes (JPEG, PNG, GIF, WebP signatures) before anything is touched; empty or fake images are `400`. `audit.test.ts` "A7" |
| A8 | DONE | Player | Clicking a current-but-stopped track did nothing; repeat-all on a one-track queue stopped; the UI could show "playing" while silent. | The queue state carries a `token` that changes whenever playback must restart, and the loader keys on it. `queueState.test.ts` (repeat-all one-track, replay, all reorder cases) |
| A9 | DONE | Player UI | Queue drag called `moveInQueue` inside a state updater (ran twice under StrictMode). | The drag lives in a ref; the move is applied once, outside any updater; `pointercancel` cancels instead of moving. Verified in the browser build |
| A10 | DONE | Client | Unguarded `localStorage` could crash the app. | All access goes through `storage.ts` (`readStored`/`writeStored`), which never throws. |

### Improvements

| ID | Status | Area | Fix |
| --- | --- | --- | --- |
| B1 | DONE | Performance | The clock (`currentTime`, `duration`) moved to its own context (`usePlayerTime`); only the seek bar re-renders as a song plays. Track rows are memoized behind one stable actions object. |
| B2 | DONE | Performance | Only `refreshTracks` bumps the playlist reload version (once per applied response); list requests are sequence-guarded so a slow old response cannot overwrite a newer one. |
| B3 | DONE | Reliability | Renames at the source have a 5 s timeout each and a 10 s budget per batch. `audit.test.ts` "B3" |
| B4 | DONE | UX | Playlist rename, delete, remove and move report errors; a failed bulk edit keeps the form and its input and shows why; the list refreshes even after a partial failure. |
| B5 | DONE | Player | The audio `error` event shows a toast and skips to the next track; if every queued track fails it stops instead of cycling. |
| B6 | DONE | Accessibility | The Now Playing sheet uses `useDialogFocus` (initial focus, Tab trap, Escape, focus restore). Navigation buttons carry `aria-current`. |
| B7 | DONE | Hardening | No `x-powered-by`; `nosniff`, `X-Frame-Options`, referrer policy and (in production) a Content-Security-Policy; text length caps; strict id parsing; bounded shutdown; WAL, `busy_timeout` and an index on `playlist_tracks(track_id)`; stored extensions restricted. `audit.test.ts` "B7", "X9" |
| B8 | DONE | Storage | A bulk cover is stored once and shared; a file is deleted only when no track still uses it. `api.test.ts` "applies one cover to many tracks" |
| B9 | DONE | Consistency | One i18n layer with English and Vietnamese (typed so a missing key is a compile error), chosen from the browser language and switchable in the sidebar. `i18n.test.ts` |
| B10 | DONE | PWA | The service worker now does something useful: it keeps the last good page so the app opens offline. |
| B11 | DONE | Tests | 22 new server tests and 85 client tests (from 58 in total to 147). |
| B12 | DEFERRED | Security note | Still no built-in authentication (documented). Keep on a trusted network or behind an authenticated reverse proxy. |

### Pro-level additions (requested: "the app is not quite at pro level")

| ID | Status | Work item |
| --- | --- | --- |
| X1 | DONE | Keyboard shortcuts: Space, ←/→ seek, Shift+←/→ and P/N previous/next, M mute, `/` search. They ignore typing and dialogs; Space still presses a button you tabbed to, but pauses after a mouse click (input modality is tracked; `:focus-visible` cannot tell). |
| X2 | DONE | The queue, position, shuffle and repeat survive a reload and restore paused. |
| X3 | DONE | Drag-and-drop upload anywhere on the page, one shared queue with real byte progress, per-file failures, and extension-based typing for browsers that report no audio type. |
| X4 | DONE | Library sorting with sensible default directions, accent- and case-insensitive, empty values last; remembered. |
| X5 | DONE | Playlist reordering: `POST /api/playlists/:id/tracks/move` and up/down buttons. Shuffle can be turned off again to restore the previous order. |
| X6 | DONE | Toast system: stacked, per-toast timers, errors announced as alerts, dismiss button. |
| X7 | DONE | `GET /api/health`, Docker `HEALTHCHECK`, non-root container user, `HOST`/`PORT` validation. |
| X8 | DONE | ESLint with the React hooks rules; CI runs lint, tests, build, `npm audit --omit=dev` and a Docker build. |
| X9 | DONE | Content-Security-Policy without inline scripts (the theme bootstrap is `public/theme-init.js`); hashed assets are cached immutably. |
| X10 | DONE | The player rules are pure, unit-tested functions (`queueState.ts`, `persistence.ts`); the audio element is driven from `PlayerProvider`. |
| X11 | DONE | New logo (gradient note with the four bars): favicon, PWA and Apple touch icons, sidebar mark, README header, theme colours. Redrawn as SVG from the supplied image; replace `public/logo*.svg` and `icon.svg` if a master file exists. |

### Deployment notes (read before releasing)

- **Docker volume ownership.** The image now runs as `node` (uid 1000). A volume created by an older image is owned by root; run once: `docker run --rm -v musik-data:/data alpine chown -R 1000:1000 /data`. A launchd or `npm start` deployment is unaffected.
- **SQLite WAL.** The database now runs in WAL mode, so `musik.db-wal` and `musik.db-shm` appear next to it. Back up the whole data folder (or stop the service first); a lone `musik.db` copy taken while running can miss recent writes.
- **CSP.** Production pages are served with a Content-Security-Policy. If a reverse proxy injects scripts or the app is embedded in a frame it will be blocked by design; adjust `CONTENT_SECURITY_POLICY` in `server/app.ts` if that is intended.
- **API changes.** Duplicate detection on `POST /api/import/audioextract` now uses the exact path; ids in request bodies must be positive integers (a `true` or `1.5` is `400`, it used to be ignored); a bulk cover now creates one file for all tracks.

### Not verified / left for later

- Not exercised: physical touch devices and Safari/iOS lock-screen behaviour, and the Docker image build (Docker is not installed on the audit machine; CI builds it).
- Checked in headless Edge: playback, pause by keyboard, session restore, sorting, language switch, upload with progress, desktop and phone-width layout, no console errors under the CSP.
- Deferred: pagination or virtualization of very large libraries (thousands of tracks render as one list); response compression (leave to the reverse proxy); matching the accent colour (still red) to the new logo palette; authentication.

## Known constraints

- Headless Edge screenshots were inspected at desktop and mobile sizes. Manual testing on physical touch devices remains recommended before release.

## Final review

- 2026-09-19: Re-reviewed the complete branch for correctness, security, accessibility, responsiveness, and deployment readiness.
- Fixed focus resets during dialog state changes, prevented mobile theme-control clipping, added dynamic viewport-height support, and made the pre-render theme bootstrap tolerate unavailable browser storage.
- 2026-09-21: Full audit and pro-level pass described above.

## Steve Jobs Product & Design Audit (2026-09-21)

Detailed audit documentation stored in [`AUDIT.md`](AUDIT.md).

### Prioritized Action Plan & Status

| Priority | ID | Status | Focus Area | Goal | Verification / Evidence |
| --- | --- | --- | --- | --- | --- |
| P0 | S1 | DONE | UI Icons | Replace all amateur unicode glyphs with crisp, accessible vector SVG icons | Created `src/components/Icons.tsx` vector library; integrated into PlayerBar, NowPlaying, TrackList, Library, PlaylistView, App |
| P0 | S2 | DONE | Tracklist UI | Redesign tracklist: progressive disclosure for action buttons on hover, animated equalizer playing indicator, clean styling | Added CSS hover transitions, animated CSS equalizer bars, verified across viewports |
| P0 | S3 | DONE | Now Playing | Ambient backdrop blur on Now Playing modal, refined drag handles, typography | Added dynamic blurred album art backdrop overlay (`.sheet__backdrop`), integrated vector handles |
| P1 | S4 | DONE | Audio Engine | Seamless track pre-buffering (pre-load next track in queue) | Implemented `getPreloadAudioElement()` in `audio.ts` & preloader pipeline in `PlayerProvider.tsx` |
| P2 | S5 | DONE | Search | Accent-tolerant & diacritic-insensitive search matching (e.g. Vietnamese diacritics) | Implemented `src/search.ts` (`normalizeSearch`, `matchesQuery`), 5 unit tests pass, integrated into Library, PlaylistView, ImportPicker |

### Verification Summary
- **TypeScript**: `tsc` zero errors (both client & server targets).
- **Unit & Integration Tests**: 152/152 tests passing (`vitest run`).
- **Linter**: `eslint` 0 errors, 0 warnings (`npm run lint`).
- **Production Build**: `vite build` cleanly transforms and bundles all assets with gzip sizing.


