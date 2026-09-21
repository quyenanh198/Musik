import { describe, expect, it } from 'vitest'; // pure text tests
import { describeImport, importSummary } from './importSummary';
import { translate, type Lang, type Translate } from './i18n';

const tr = (lang: Lang): Translate => (key, params) => translate(lang, key, params);

describe('importSummary', () => {
  it('names each outcome that actually happened (Vietnamese wording unchanged)', () => {
    const vi = tr('vi');
    expect(importSummary(vi, 3, 0, 0)).toBe('Đã nhập 3 bài');
    expect(importSummary(vi, 2, 1, 4)).toBe('Đã nhập 2 bài · 4 bài đã có sẵn · 1 bài lỗi');
  });

  it('says so when a pick was all duplicates, instead of claiming zero imports', () => {
    const vi = tr('vi');
    expect(importSummary(vi, 0, 0, 5)).toBe('5 bài đã có sẵn');
    expect(importSummary(vi, 0, 0, 0)).toBe('Không có gì để nhập');
  });

  it('reads naturally in English, including the singular', () => {
    const en = tr('en');
    expect(importSummary(en, 1, 0, 0)).toBe('Imported 1 track');
    expect(importSummary(en, 3, 1, 2)).toBe('Imported 3 tracks · 2 already in the library · 1 failed');
    expect(importSummary(en, 0, 0, 0)).toBe('Nothing to import');
  });
});

describe('describeImport', () => {
  const track = {} as never;
  it('is plain news when nothing failed', () => {
    expect(describeImport(tr('en'), { imported: [track], failed: [], skipped: [] })).toEqual({ message: 'Imported 1 track', kind: 'info' });
  });

  it('is an error that carries the first reason when something failed', () => {
    const result = describeImport(tr('en'), { imported: [], failed: [{ path: 'a/b.wav', error: 'Remote audio file is too large' }], skipped: [] });
    expect(result.kind).toBe('error');
    expect(result.message).toBe('1 failed — Remote audio file is too large');
  });
});
