export type ShortcutAction = 'toggle' | 'seekBack' | 'seekForward' | 'next' | 'previous' | 'mute' | 'search';

export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface TargetInfo {
  tag: string;
  editable: boolean;
  /**
   * The focused element got focus from the keyboard (`:focus-visible`). A button focused by a mouse click is not
   * "in use": Space should then pause the music, not press that button again. Absent means assume the keyboard.
   */
  keyboardFocus?: boolean;
}

/** How far the arrow keys seek, in seconds. */
export const SEEK_STEP = 5;

/**
 * Which player action, if any, a key press means. Typing must never trigger playback, a focused button keeps its own
 * Space/Enter, and an open dialog owns the keyboard, so this answers "no action" in all of those cases.
 */
export function resolveShortcut(e: KeyInfo, target: TargetInfo, dialogOpen: boolean): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || dialogOpen) return null;
  const tag = target.tag.toUpperCase();
  if (target.editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  switch (e.key) {
    case ' ':
      return (tag === 'BUTTON' || tag === 'A') && target.keyboardFocus !== false ? null : 'toggle';
    case 'ArrowLeft':
      return e.shiftKey ? 'previous' : 'seekBack';
    case 'ArrowRight':
      return e.shiftKey ? 'next' : 'seekForward';
    case 'n':
    case 'N':
      return 'next';
    case 'p':
    case 'P':
      return 'previous';
    case 'm':
    case 'M':
      return 'mute';
    case '/':
      return 'search';
    default:
      return null;
  }
}
