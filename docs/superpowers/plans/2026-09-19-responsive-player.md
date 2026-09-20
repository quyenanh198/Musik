# Responsive Musik Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a responsive, accessible, light/dark Musik UI and close the reliability and security findings from the code audit.

**Architecture:** Preserve the existing React/Express/SQLite structure. Add small pure helpers for preferences and import limits, expose explicit application cleanup, then restyle the current semantic components with a token-based responsive CSS layer.

**Tech Stack:** React 19, TypeScript, Express 5, Node SQLite, Vitest, Vite.

## Global Constraints

- Preserve AudioExtract and Lazybutts integration.
- Preserve all existing Musik features.
- Use original Musik branding; layout inspiration must not copy YouTube trademarks or assets.
- Support light, dark, and system preferences on desktop and mobile.

---

### Task 1: Application lifecycle and upload/import hardening

**Files:** `server/app.ts`, `server/index.ts`, `server/metadata.ts`, `server/routes/tracks.ts`, `server/routes/imports.ts`, `server/tests/api.test.ts`

- [x] Add failing regression tests for explicit database close, spoofed audio, failed-upload cleanup, and bounded imports.
- [x] Run the focused API tests and confirm the new assertions fail for the intended reasons.
- [x] Add `app.locals.close`, graceful process shutdown, strict audio parsing, cleanup paths, and bounded remote streaming.
- [x] Run all API tests and confirm they pass on Windows without locked temporary directories.

### Task 2: Safe preferences and theme foundation

**Files:** `src/preferences.ts`, `src/preferences.test.ts`, `src/player/PlayerProvider.tsx`, `src/main.tsx`, `index.html`, `src/App.tsx`

- [x] Add failing pure tests for invalid stored volume and theme preference normalization.
- [x] Implement clamping and theme preference helpers.
- [x] Add an accessible theme selector and pre-mount theme bootstrap.
- [x] Run the focused preference tests and TypeScript checks.

### Task 3: Responsive visual system and accessible interactions

**Files:** `src/styles.css`, `src/App.tsx`, `src/components/*.tsx`

- [x] Preserve valid UTF-8 symbols and label every icon-only action.
- [x] Apply tokenized light/dark surfaces, responsive navigation, track presentation, dialogs, and player layouts.
- [x] Add visible focus, live-region feedback, 44px targets, mobile reflow, dialog focus management, and reduced-motion handling.
- [x] Verify production build and inspect desktop/mobile renders.

### Task 4: Dependency and hand-off completion

**Files:** `package.json`, `package-lock.json`, `HANDOFF.md`

- [x] Upgrade Vitest to a non-vulnerable release and update the lockfile.
- [x] Run tests, build, and production dependency audit.
- [x] Update every hand-off item with its final status and verification evidence.
