import { describe, expect, it } from 'vitest';
import { importSummary } from './importSummary';

describe('importSummary', () => {
  it('names each outcome that actually happened', () => {
    expect(importSummary(3, 0, 0)).toBe('Đã nhập 3 bài');
    expect(importSummary(2, 1, 4)).toBe('Đã nhập 2 bài · 4 bài đã có sẵn · 1 bài lỗi');
  });

  it('says so when a pick was all duplicates, instead of claiming zero imports', () => {
    expect(importSummary(0, 0, 5)).toBe('5 bài đã có sẵn');
    expect(importSummary(0, 0, 0)).toBe('Không có gì để nhập');
  });
});
