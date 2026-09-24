/**
 * Cùng một bài hát tải về hai lần thì file không giống nhau từng byte: thẻ ID3 và phần
 * đệm khác vài chục byte. Khớp đúng kích thước như trước bỏ lọt hết những bản đó —
 * thư viện vẫn còn 75 cặp trùng sau lần dọn đầu tiên.
 *
 * Nhưng cũng đừng gom nhầm: hai bản thu khác nhau hay gặp trùng tên (bản gốc và bản
 * cover, live và studio). Chúng khác nhau ở độ dài. Nên quy tắc là: **cùng tên, cùng độ
 * dài tới từng giây, kích thước lệch dưới 1%** mới coi là một bài.
 */
export interface TrackSignature {
  title: string;
  /** Giây; null khi chưa đọc được từ file. */
  duration: number | null;
  size: number;
}

/** Bỏ khoảng trắng thừa và phân biệt hoa thường khi so tên. */
export const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

const DURATION_TOLERANCE_S = 1;
const SIZE_TOLERANCE_RATIO = 0.01;
/** File rất nhỏ thì 1% chỉ là vài trăm byte — cho một sàn tối thiểu. */
const SIZE_TOLERANCE_FLOOR_BYTES = 4096;

export function sameRecording(a: TrackSignature, b: TrackSignature): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false;
  // Thiếu độ dài thì không có gì tách bản thu này với bản thu kia: quay về luật cũ,
  // đúng từng byte mới dám coi là trùng.
  if (a.duration === null || b.duration === null) return a.size === b.size;
  if (Math.abs(a.duration - b.duration) > DURATION_TOLERANCE_S) return false;
  const tolerance = Math.max(SIZE_TOLERANCE_FLOOR_BYTES, Math.max(a.size, b.size) * SIZE_TOLERANCE_RATIO);
  return Math.abs(a.size - b.size) <= tolerance;
}

/** Bản đã có trong thư viện trùng với bài đang định thêm, nếu có. */
export function findDuplicate<T extends TrackSignature>(existing: T[], candidate: TrackSignature): T | null {
  return existing.find((row) => sameRecording(row, candidate)) ?? null;
}
