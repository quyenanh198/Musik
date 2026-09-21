import { useI18n } from '../I18nProvider';
import type { UploadState } from '../useUploader';

/** Progress of the running upload (real bytes, current file) and the files that could not be uploaded. */
export function UploadStatus({ state, onDismiss }: { state: UploadState; onDismiss: () => void }) {
  const { t } = useI18n();
  if (!state.active && state.failures.length === 0) return null;
  const overall = state.total > 0 ? Math.min(1, (state.done + state.fraction) / state.total) : 0;

  return (
    <div className="upload-status">
      {state.active && (
        <div role="status" aria-live="polite">
          <div className="upload-status__line">
            <span>{t('upload.progress', { done: Math.min(state.done + 1, state.total), total: state.total })}</span>
            <span className="muted upload-status__name">{state.currentName}</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)}>
            <div className="progress__bar" style={{ width: `${overall * 100}%` }} />
          </div>
        </div>
      )}
      {state.failures.length > 0 && (
        <div role="alert" className="upload-status__failures">
          <div className="upload-status__line">
            <strong>{t('upload.failed', { n: state.failures.length })}</strong>
            <button className="btn btn--ghost" onClick={onDismiss}>
              {t('common.dismiss')}
            </button>
          </div>
          <ul>
            {state.failures.map((failure, i) => (
              <li key={`${failure.name}-${i}`}>
                {failure.name}: <span className="muted">{failure.error ?? t('upload.notAudio')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
