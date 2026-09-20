export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_KEY = 'musik:theme';

export function normalizeVolume(raw: string | number | null | undefined): number {
  const value = typeof raw === 'number' ? raw : raw === null || raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function normalizeTheme(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function applyTheme(theme: ThemePreference): void {
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
