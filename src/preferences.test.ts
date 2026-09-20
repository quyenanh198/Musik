import { describe, expect, it } from 'vitest';
import { normalizeTheme, normalizeVolume } from './preferences';

describe('normalizeVolume', () => {
  it.each([
    [null, 1],
    ['not-a-number', 1],
    ['-2', 0],
    ['2', 1],
    ['0.35', 0.35],
  ])('normalizes %j to %s', (raw, expected) => {
    expect(normalizeVolume(raw)).toBe(expected);
  });
});

describe('normalizeTheme', () => {
  it.each([
    [null, 'system'],
    ['unknown', 'system'],
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
  ] as const)('normalizes %j to %s', (raw, expected) => {
    expect(normalizeTheme(raw)).toBe(expected);
  });
});
