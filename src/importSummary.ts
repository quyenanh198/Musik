/** One line telling the user what an AudioExtract import actually did. */
export function importSummary(imported: number, failed: number, skipped: number): string {
  const parts: string[] = [];
  if (imported) parts.push(`Đã nhập ${imported} bài`);
  if (skipped) parts.push(`${skipped} bài đã có sẵn`);
  if (failed) parts.push(`${failed} bài lỗi`);
  return parts.length ? parts.join(' · ') : 'Không có gì để nhập';
}
