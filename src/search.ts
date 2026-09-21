/**
 * Normalize a string for diacritic-insensitive and case-insensitive matching.
 * Converts characters like 'é', 'à', 'ế', 'ơ', 'đ' into their ASCII base equivalents.
 */
export function normalizeSearch(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacritical marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

/**
 * Checks if a query string matches the target text, insensitive to accents and case.
 */
export function matchesQuery(target: string, query: string): boolean {
  if (!query) return true;
  if (!target) return false;
  return normalizeSearch(target).includes(normalizeSearch(query));
}
