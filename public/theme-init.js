// Runs before the app renders so the first paint already has the right theme (no light flash in dark mode).
// A file, not an inline script, so the page can ship a Content-Security-Policy without 'unsafe-inline' for scripts.
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('musik:theme');
  } catch {
    // storage may be unavailable
  }
  const theme = saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
