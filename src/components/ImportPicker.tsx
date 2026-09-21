import { useEffect, useMemo, useState } from 'react';
import { api, formatSize, type ImportResult, type RemoteFile } from '../api';
import { useI18n } from '../I18nProvider';
import { useDialogFocus } from '../useDialogFocus';

/** Modal listing finished AudioExtract downloads; ticked files are copied into the library (and playlist, if given). */
export function ImportPicker({
  playlistId,
  playlistName,
  onDone,
  onClose,
}: {
  playlistId?: number;
  playlistName?: string;
  onDone: (result: ImportResult) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When every chosen file failed the picker stays open and says why for each. */
  const [failed, setFailed] = useState<ImportResult['failed']>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Optional per-file title, edited inline; empty = keep the tag/filename.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // import request in flight
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose, busy);

  useEffect(() => {
    api
      .listAudioExtract()
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [files, query]);
  // Files already in the library can't be picked, so "all" means all the new ones.
  const selectable = useMemo(() => shown.filter((f) => f.trackId === null), [shown]);
  const alreadyCount = shown.length - selectable.length;
  const allShown = selectable.length > 0 && selectable.every((f) => chosen.has(f.path));

  const toggle = (p: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const toggleAll = () =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (allShown) selectable.forEach((f) => next.delete(f.path));
      else selectable.forEach((f) => next.add(f.path));
      return next;
    });

  const submit = async () => {
    if (chosen.size === 0) return;
    setBusy(true);
    setError(null);
    setFailed([]);
    try {
      const result = await api.importFromAudioExtract(
        [...chosen].map((p) => ({ path: p, title: titles[p]?.trim() || undefined })),
        playlistId,
      );
      if (result.imported.length === 0 && result.failed.length > 0) {
        setFailed(result.failed);
        setBusy(false);
        return;
      }
      onDone(result);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const nameOf = (path: string) => files?.find((f) => f.path === path)?.name ?? path;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={t('import.title')} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <strong>
            {t('import.title')}
            {playlistName ? ` → ${playlistName}` : ''}
          </strong>
          <input
            className="search"
            type="search"
            placeholder={t('common.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('import.search')}
            autoFocus
          />
          <label className="modal__all">
            <input type="checkbox" checked={allShown} onChange={toggleAll} disabled={selectable.length === 0} />
            {t('import.allNew', { n: selectable.length })}
            {alreadyCount > 0 && <span className="muted"> · {t('import.alreadyCount', { n: alreadyCount })}</span>}
          </label>
        </div>
        <div className="modal__list">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {failed.length > 0 && (
            <div className="error" role="alert">
              <strong>{t('import.noneImported')}</strong>
              <ul className="import-failures">
                {failed.map((f) => (
                  <li key={f.path}>
                    {nameOf(f.path)}: <span>{f.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {files === null && !error ? (
            <p className="muted">{t('common.loading')}</p>
          ) : shown.length === 0 ? (
            <p className="muted">{files && files.length === 0 ? t('import.nothingExtracted') : t('library.noMatches')}</p>
          ) : (
            shown.map((f) => {
              const base = f.name.replace(/\.[^.]+$/, '');
              const done = f.trackId !== null;
              return (
                <div key={f.path} className={`pick pick--row${chosen.has(f.path) ? ' pick--on' : ''}${done ? ' pick--done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={chosen.has(f.path)}
                    onChange={() => toggle(f.path)}
                    disabled={busy || done}
                    aria-label={done ? t('import.inLibraryNamed', { name: f.name }) : t('import.select', { name: f.name })}
                  />
                  {editing === f.path ? (
                    <input
                      className="pick__edit"
                      value={titles[f.path] ?? base}
                      placeholder={base}
                      autoFocus
                      maxLength={300}
                      aria-label={t('import.titleFor', { name: f.name })}
                      onChange={(e) => setTitles((prev) => ({ ...prev, [f.path]: e.target.value }))}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="pick__title" onClick={() => !done && toggle(f.path)}>
                      {titles[f.path]?.trim() ? (
                        <>
                          {titles[f.path]} <span className="muted">({f.name})</span>
                        </>
                      ) : (
                        f.name
                      )}
                      {done && (
                        <span className="pick__badge" title={t('import.importedAs', { title: f.title ?? '' })}>
                          {t('import.imported')}
                          {f.title && f.title !== base ? ` · ${f.title}` : ''}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="muted">
                    {formatSize(f.size)} · {new Date(f.updatedAt).toLocaleDateString()}
                  </span>
                  <button
                    className="icon"
                    title={done ? t('import.renameInLibrary') : t('import.setTitle')}
                    aria-label={done ? t('import.renameInLibrary') : t('import.setTitle')}
                    disabled={busy || done}
                    onClick={() => {
                      setChosen((prev) => new Set(prev).add(f.path));
                      setEditing(f.path);
                    }}
                  >
                    ✎
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="modal__foot">
          <span className="muted">{t('picker.selected', { n: chosen.size })}</span>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn" onClick={() => void submit()} disabled={busy || chosen.size === 0}>
            {busy ? t('import.importing') : t('import.importN', { n: chosen.size || '' })}
          </button>
        </div>
      </div>
    </div>
  );
}
