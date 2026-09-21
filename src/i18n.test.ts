import { describe, expect, it } from 'vitest';
import { detectLang, messages, translate } from './i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('have the same keys in both languages', () => {
    expect(Object.keys(messages.vi).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('use the same placeholders in both languages, so no value is dropped or left as {name}', () => {
    for (const key of Object.keys(messages.en) as (keyof typeof messages.en)[]) {
      expect(placeholders(messages.vi[key]), key).toEqual(placeholders(messages.en[key]));
    }
  });

  it('have no empty text', () => {
    for (const lang of ['en', 'vi'] as const) {
      for (const [key, text] of Object.entries(messages[lang])) expect(text.trim(), `${lang} ${key}`).not.toBe('');
    }
  });
});

describe('translate', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'toast.addedOne', { title: 'Song', name: 'Mix' })).toBe('Added "Song" to Mix');
    expect(translate('en', 'toast.addedOne', { title: 'Song' })).toBe('Added "Song" to {name}');
  });

  it('picks the singular form for one, English only where it differs', () => {
    expect(translate('en', 'common.tracks', { n: 1 })).toBe('1 track');
    expect(translate('en', 'common.tracks', { n: 2 })).toBe('2 tracks');
    expect(translate('en', 'common.tracks', { n: 0 })).toBe('0 tracks');
    expect(translate('vi', 'common.tracks', { n: 1 })).toBe('1 bài');
  });
});

describe('detectLang', () => {
  it('prefers the saved choice, then the browser language, then English', () => {
    expect(detectLang('en', 'vi-VN')).toBe('en');
    expect(detectLang('vi', 'en-US')).toBe('vi');
    expect(detectLang(null, 'vi-VN')).toBe('vi');
    expect(detectLang(null, 'fr-FR')).toBe('en');
    expect(detectLang('klingon', undefined)).toBe('en');
  });
});
