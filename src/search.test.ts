import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeSearch } from './search';

describe('normalizeSearch', () => {
  it('converts accented characters to base form', () => {
    expect(normalizeSearch('Trịnh Công Sơn')).toBe('trinh cong son');
    expect(normalizeSearch('Đổi thay')).toBe('doi thay');
    expect(normalizeSearch('Café')).toBe('cafe');
    expect(normalizeSearch('Hà Nội')).toBe('ha noi');
  });

  it('handles empty strings and whitespace', () => {
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('   ')).toBe('');
  });
});

describe('matchesQuery', () => {
  it('matches regardless of accents and casing', () => {
    expect(matchesQuery('Trịnh Công Sơn', 'trinh')).toBe(true);
    expect(matchesQuery('Trịnh Công Sơn', 'CONG')).toBe(true);
    expect(matchesQuery('Đổi Thay', 'doi')).toBe(true);
    expect(matchesQuery('Bài Ca Đất Phương Nam', 'dat phuong')).toBe(true);
    expect(matchesQuery('Chuyện hoa sim', 'chuyen')).toBe(true);
  });

  it('returns false when no match', () => {
    expect(matchesQuery('Trịnh Công Sơn', 'Pham Duy')).toBe(false);
  });

  it('matches on empty query', () => {
    expect(matchesQuery('Any track', '')).toBe(true);
  });
});
