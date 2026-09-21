import type { ImportResult } from './api';
import type { Translate } from './i18n';

/** One line telling the user what an AudioExtract import actually did. */
export function importSummary(t: Translate, imported: number, failed: number, skipped: number): string {
  const parts: string[] = [];
  if (imported) parts.push(t('import.summary.imported', { n: imported }));
  if (skipped) parts.push(t('import.summary.skipped', { n: skipped }));
  if (failed) parts.push(t('import.summary.failed', { n: failed }));
  return parts.length ? parts.join(' · ') : t('import.summary.nothing');
}

/** The message to show after an import, and whether it is bad news: a failure carries the first reason so it is not just a count. */
export function describeImport(t: Translate, result: Pick<ImportResult, 'imported' | 'failed' | 'skipped'>): { message: string; kind: 'info' | 'error' } {
  const summary = importSummary(t, result.imported.length, result.failed.length, result.skipped.length);
  if (result.failed.length === 0) return { message: summary, kind: 'info' };
  return { message: `${summary} — ${result.failed[0].error}`, kind: 'error' };
}
