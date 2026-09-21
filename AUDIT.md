# Musik — Product & Design Audit (Steve Jobs Persona Review)

Date: 2026-09-21  
Auditor Persona: Steve Jobs (Relentless Taste, Simplicity, Craft)

---

## The Verdict

> *"Details matter, it's worth waiting to get it right."*

Musik has a remarkably solid engineering foundation:
- Zero TypeScript errors (`tsc --noEmit`)
- 147 unit and integration tests passing (`vitest run`)
- Node.js 22 built-in `node:sqlite` with WAL mode & foreign keys
- Robust security boundaries (audio byte sniffing, CSP, safe path validation, length limits)
- Offline-ready PWA service worker and bilingual i18n support (English / Vietnamese)

**However, it currently feels like an internal engineering database or spreadsheet rather than an emotional, delightful music listening experience.** Music is personal and artistic. The player must celebrate the music and get out of the way.

---

## Prioritized Transformation Roadmap

### Phase 1: The Visual & Tactile Experience (P0)
1. **Surgical Iconography Overhaul**
   - Eliminate raw unicode characters (`▶`, `⏸`, `⏮`, `⏭`, `↻¹`, `⌃`, `⏾`, `⠿`, `✎`, `🗑`, `✕`, `↑`, `↓`) which render inconsistently across Windows, iOS, macOS, and Android.
   - Introduce clean, handcrafted vector SVG icons with consistent stroke weight, crisp optical alignment, and smooth hover/press states.
2. **Tracklist Redesign — From Spreadsheet to Music Showcase**
   - Replace the rigid table look with a refined, airy track row design.
   - Clean up row clutter: hide secondary action buttons (playlist dropdown, up/down move, edit, remove, delete) behind progressive disclosure (revealed on row hover or accessible via a sleek `•••` action menu).
   - Display rich album art thumbnails, crisp typography, and an animated playing indicator for active tracks.
3. **Immersive Now Playing Experience**
   - Elevate the Now Playing modal with dynamic ambient backdrop illumination derived from the album art or elegant color grading.
   - Improve the drag-and-drop queue interaction and typography hierarchy.
4. **Design Tokens & CSS Organization**
   - Clean up `src/styles.css` into organized sections: design tokens, layout primitives, component styles, and responsive breakpoints.

### Phase 2: Core Audio Craft (P1)
1. **Pre-buffering & Seamless Track Transitions**
   - Pre-load the next track in the queue 10–15 seconds before the current track finishes.
   - Minimize transition latency between songs for uninterrupted listening flow.
2. **Audio Volume Normalization & Sound Polish**
   - Smooth volume fades on pause/play to avoid audio pop/clicks.

### Phase 3: Discovery & Organization (P2)
1. **Smart Filtering & Accent-Tolerant Search**
   - Normalize Vietnamese diacritics and case for seamless search matching.
2. **Albums & Artists Grouping**
   - Provide organized views for browsing by Artist, Album, or Genre rather than only a single flat list.
