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

## Audit 2026-09-21 (commit 05d3c37)

Baseline before the audit: `tsc` clean (server and client), 58 tests passing, `npm audit` 0 vulnerabilities.
Items marked "reproduced" were confirmed with a throwaway test before being written down. Update the status column as each item lands.

### Bugs

| ID | Status | Area | Finding | Evidence |
| --- | --- | --- | --- | --- |
| A1 | OPEN | Import | A second file from an AudioExtract folder that already had one file imported is skipped as "already imported" and reported with the first file's title. The POST duplicate check ignores that a folder can hold several files (`imports.ts`). | Reproduced: second import returned `skipped` with title of the first file while the list showed `trackId = null` |
| A2 | OPEN | Import / UI | When nothing imports and something failed the server answers 502 with per-file reasons in the body, but the client only shows the status text ("Bad Gateway"). | Code reading (`api.ts` `request`, `imports.ts` status) |
| A3 | OPEN | Import | The 30 s AudioExtract timeout also aborts the response body, so any download that takes longer than 30 s fails. | Reproduced: headers arrived, body read failed with `TimeoutError` |
| A4 | OPEN | Import / Security | Import paths are not validated, so `../../secret` escapes the `/api/files/` route on the remote host (GET only, `audio/*` responses only). | Reproduced: remote saw `/secret` |
| A5 | OPEN | API | Malformed or oversized JSON returns 500 and logs a stack trace instead of 400/413; the error handler ignores `err.status`. | Reproduced: 500 `Internal server error` |
| A6 | OPEN | API | `PATCH /api/tracks/:id` without a body returns 500 (`body.year` on `undefined`). | Reproduced: 500 |
| A7 | OPEN | API | An empty cover upload removes the track's existing cover (`saveCover` returns null and null is stored). | Reproduced: cover present, then empty upload, cover null, 0 files on disk |
| A8 | OPEN | Player | Clicking a track that is current but stopped does nothing (the load effect is keyed on the track id only); repeat-all on a one-track queue stops after the song ends; the UI can show "playing" while silent. | Code reading (`PlayerProvider.tsx` load effect, `next()`) |
| A9 | OPEN | Player UI | Queue drag-reorder calls `moveInQueue` inside a state updater; under `StrictMode` it runs twice in development and React warns about updating another component during render. | Code reading (`NowPlaying.tsx`, `main.tsx`) |
| A10 | OPEN | Client | `localStorage` is read and written without a guard in `App.tsx` and `PlayerProvider.tsx`; blocked storage crashes the whole app. Only the `index.html` bootstrap is guarded. | Code reading |

### Improvements

| ID | Status | Area | Finding |
| --- | --- | --- | --- |
| B1 | OPEN | Performance | Every `timeupdate` (about 4 per second) re-renders every `usePlayer()` consumer, including every `TrackList` row; each row also renders a full playlist `<select>`. |
| B2 | OPEN | Performance | One upload inside a playlist triggers about three redundant playlist refetches (`load()` plus two `version` bumps); stale list responses can overwrite newer ones. |
| B3 | OPEN | Reliability | A bulk title change renames the AudioExtract files one by one with a 30 s timeout each, blocking the response while the remote is unreachable. |
| B4 | OPEN | UX | `PlaylistView.rename`/`remove` have no error handling; a failed bulk edit closes the form and loses input; a partial failure in `editTrack`/`editMany` leaves the list stale. |
| B5 | OPEN | Player | The audio element has no `error` handler, so a broken stream goes silent. |
| B6 | OPEN | Accessibility | `NowPlaying` is `aria-modal` but does not move or trap focus like the other dialogs. |
| B7 | OPEN | Hardening | `x-powered-by` is sent, no `nosniff`/CSP headers, text fields have no length cap, shutdown can hang on open audio streams, no WAL / `busy_timeout`, no index on `playlist_tracks(track_id)`, ids are parsed loosely. |
| B8 | OPEN | Storage | Bulk cover stores one copy of the image per track. |
| B9 | OPEN | Consistency | Vietnamese and English UI strings are mixed. |
| B10 | OPEN | PWA | `sw.js` registers an empty fetch handler, which newer Chrome versions flag as a performance cost. |
| B11 | OPEN | Tests | No test covers A1 to A7. |
| B12 | OPEN | Security note | No authentication (documented). Keep on a trusted network or behind an authenticated reverse proxy. |

### Pro-level additions (requested: "the app is not quite at pro level")

| ID | Status | Work item |
| --- | --- | --- |
| X1 | OPEN | Keyboard shortcuts (space, arrows, next/previous, mute, focus search) |
| X2 | OPEN | Queue, position, shuffle and repeat survive a reload |
| X3 | OPEN | Drag-and-drop upload with real byte progress |
| X4 | OPEN | Library sorting (title, artist, album, added, duration), remembered |
| X5 | OPEN | Playlist reordering (API and UI) |
| X6 | OPEN | Toast system (stacked, timed, errors announced as alerts) |
| X7 | OPEN | `/api/health`, Docker `HEALTHCHECK`, non-root container user |
| X8 | OPEN | ESLint (with React hooks rules) and CI gates for lint and `npm audit` |
| X9 | OPEN | Content-Security-Policy and security headers in production |
| X10 | OPEN | Player state machine extracted into pure, unit-tested functions |

## Known constraints

- Headless Edge screenshots were inspected at desktop and mobile sizes. Manual testing on physical touch devices remains recommended before release.

## Final review

- 2026-09-19: Re-reviewed the complete branch for correctness, security, accessibility, responsiveness, and deployment readiness.
- Fixed focus resets during dialog state changes, prevented mobile theme-control clipping, added dynamic viewport-height support, and made the pre-render theme bootstrap tolerate unavailable browser storage.
