import { describe, expect, it } from 'vitest';
import { findDuplicate, normalizeTitle, sameRecording } from '../duplicates.js';

const track = (title: string, duration: number | null, size: number) => ({ title, duration, size });

describe('sameRecording', () => {
  it('coi cùng một bài tải hai lần là trùng dù lệch vài chục byte', () => {
    // Đúng cặp có thật trong thư viện: cùng tên, cùng 27 giây, lệch 49 byte.
    expect(sameRecording(track('Mãi Mãi Bên Em', 27, 771788), track('Mãi Mãi Bên Em', 27, 771837))).toBe(true);
    expect(sameRecording(track('壞運氣清零', 166, 5272748), track('壞運氣清零', 166, 5272605))).toBe(true);
  });

  it('không gom hai bản thu khác nhau trùng tên', () => {
    // Cũng là cặp có thật: cùng tên "雨蝶" nhưng 209 giây và 233 giây.
    expect(sameRecording(track('雨蝶', 209, 6506397), track('雨蝶', 233, 7675149))).toBe(false);
  });

  it('bỏ qua hoa thường và khoảng trắng thừa trong tên', () => {
    expect(normalizeTitle('  Hoa   Nở  ')).toBe('hoa nở');
    expect(sameRecording(track('Hoa Nở', 100, 1_000_000), track('  hoa   nở ', 100, 1_000_500))).toBe(true);
  });

  it('tên khác nhau thì không bao giờ là trùng', () => {
    expect(sameRecording(track('Bài A', 100, 1_000_000), track('Bài B', 100, 1_000_000))).toBe(false);
  });

  it('lệch kích thước quá 1% là hai bài khác nhau', () => {
    expect(sameRecording(track('Bài A', 200, 5_000_000), track('Bài A', 200, 5_200_000))).toBe(false);
  });

  it('file nhỏ vẫn có sàn dung sai 4KB', () => {
    expect(sameRecording(track('Chuông', 3, 20_000), track('Chuông', 3, 23_000))).toBe(true);
    expect(sameRecording(track('Chuông', 3, 20_000), track('Chuông', 3, 30_000))).toBe(false);
  });

  it('thiếu độ dài thì phải trùng đúng từng byte', () => {
    expect(sameRecording(track('Bài A', null, 1_000_000), track('Bài A', 100, 1_000_000))).toBe(true);
    expect(sameRecording(track('Bài A', null, 1_000_000), track('Bài A', 100, 1_000_050))).toBe(false);
  });
});

describe('findDuplicate', () => {
  it('trả về đúng dòng đã có trong thư viện', () => {
    const rows = [
      { id: 1, ...track('雨蝶', 209, 6506397) },
      { id: 2, ...track('雨蝶', 233, 7675149) },
    ];
    expect(findDuplicate(rows, track('雨蝶', 233, 7675200))?.id).toBe(2);
    expect(findDuplicate(rows, track('雨蝶', 150, 4000000))).toBeNull();
  });
});
