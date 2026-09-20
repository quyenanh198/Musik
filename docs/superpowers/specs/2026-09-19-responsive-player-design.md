# Responsive Musik Player Design

## Objective

Refresh Musik with a minimalist interface inspired by YouTube Music's layout conventions while retaining its own name and visual identity. Support light and dark themes, desktop and mobile layouts, and every existing library, playlist, import, metadata, and playback workflow.

## Visual system

- Use a neutral surface hierarchy, rounded search/actions, restrained red accent, and compact iconography.
- Support `light`, `dark`, and `system` theme preferences. Store the explicit preference locally and apply it before React mounts to prevent a theme flash.
- Keep all action targets at least 44px, provide visible keyboard focus, and never use color alone to communicate state.
- Use semantic text or inline SVG icons rather than mojibake-prone Unicode glyphs.

## Responsive structure

- Desktop: persistent navigation rail, spacious content panel, metadata table, fixed player bar.
- Mobile: compact top bar, horizontally scrollable playlist navigation, track cards with secondary metadata, and a two-row player with usable controls.
- Dialogs fit small screens, trap focus, close with Escape, restore focus, and expose a labelled dialog role.

## Reliability and security

- Give the application an explicit close lifecycle for its SQLite connection and close it on process shutdown.
- Reject uploads whose bytes cannot be parsed as audio even when the client claims an `audio/*` MIME type.
- Remove partially written audio and cover files whenever metadata or database persistence fails.
- Bound AudioExtract imports by timeout and maximum byte size.
- Clamp persisted and user-supplied volume values to `0..1`.
- Upgrade the vulnerable Vitest development dependency.

## Verification

- API regression tests cover lifecycle, spoofed audio rejection, cleanup, import timeout/size handling, and existing behavior.
- Pure player preference tests cover invalid volume values.
- Typecheck and production build must pass.
- Static accessibility checks cover focus visibility, target sizes, theme control names, live status, and responsive breakpoints.

