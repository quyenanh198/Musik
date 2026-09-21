import { describe, expect, it } from 'vitest';
import { resolveShortcut, type KeyInfo } from './shortcuts';

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
const page = { tag: 'BODY', editable: false };

describe('resolveShortcut', () => {
  it.each([
    [' ', 'toggle'],
    ['ArrowLeft', 'seekBack'],
    ['ArrowRight', 'seekForward'],
    ['n', 'next'],
    ['P', 'previous'],
    ['m', 'mute'],
    ['/', 'search'],
  ])('maps %j to %s', (k, action) => {
    expect(resolveShortcut(key(k), page, false)).toBe(action);
  });

  it('uses shift with the arrows for previous and next', () => {
    expect(resolveShortcut(key('ArrowLeft', { shiftKey: true }), page, false)).toBe('previous');
    expect(resolveShortcut(key('ArrowRight', { shiftKey: true }), page, false)).toBe('next');
  });

  it('stays out of the way while typing or using form controls', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(resolveShortcut(key(' '), { tag, editable: false }, false)).toBeNull();
    expect(resolveShortcut(key('m'), { tag: 'DIV', editable: true }, false)).toBeNull();
  });

  it('leaves Space to a button focused with the keyboard, but not one merely left focused by a mouse click', () => {
    expect(resolveShortcut(key(' '), { tag: 'BUTTON', editable: false, keyboardFocus: true }, false)).toBeNull();
    expect(resolveShortcut(key(' '), { tag: 'BUTTON', editable: false }, false)).toBeNull();
    expect(resolveShortcut(key(' '), { tag: 'BUTTON', editable: false, keyboardFocus: false }, false)).toBe('toggle');
    expect(resolveShortcut(key('n'), { tag: 'BUTTON', editable: false }, false)).toBe('next');
  });

  it('ignores browser shortcuts and open dialogs', () => {
    expect(resolveShortcut(key('n', { ctrlKey: true }), page, false)).toBeNull();
    expect(resolveShortcut(key('p', { metaKey: true }), page, false)).toBeNull();
    expect(resolveShortcut(key('m', { altKey: true }), page, false)).toBeNull();
    expect(resolveShortcut(key(' '), page, true)).toBeNull();
  });

  it('ignores keys it does not own', () => {
    expect(resolveShortcut(key('ArrowUp'), page, false)).toBeNull(); // scrolls the list
    expect(resolveShortcut(key('a'), page, false)).toBeNull();
  });
});
