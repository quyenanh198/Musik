import { useEffect, useMemo, useState } from 'react';
import type { Track } from '../../shared/types';
import { api, formatSize, type RemoteFile } from '../api';

/** Modal listing finished AudioExtract downloads; ticked files are copied into the library (and playlist, if given). */
export function ImportPicker({
  playlistId,
  playlistName,
  onDone,
  onClose,
}: {
  playlistId?: number;
  playlistName?: string;
  onDone: (imported: Track[], failed: { path: string; error: string }[]) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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
  const allShown = shown.length > 0 && shown.every((f) => chosen.has(f.path));

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
      if (allShown) shown.forEach((f) => next.delete(f.path));
      else shown.forEach((f) => next.add(f.path));
      return next;
    });

  const submit = async () => {
    if (chosen.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFromAudioExtract([...chosen], playlistId);
      onDone(result.imported, result.failed);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" role="dialog" aria-label="Import from AudioExtract" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <strong>Import from AudioExtract{playlistName ? ` → ${playlistName}` : ''}</strong>
          <input
            className="search"
            type="search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search AudioExtract files"
            autoFocus
          />
          <label className="modal__all">
            <input type="checkbox" checked={allShown} onChange={toggleAll} disabled={shown.length === 0} />
            All shown ({shown.length})
          </label>
        </div>
        <div className="modal__list">
          {error && <p className="error">{error}</p>}
          {files === null && !error ? (
            <p className="muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="muted">{files && files.length === 0 ? 'Nothing extracted yet — results appear here for 7 days.' : 'No matches.'}</p>
          ) : (
            shown.map((f) => (
              <label key={f.path} className={`pick${chosen.has(f.path) ? ' pick--on' : ''}`}>
                <input type="checkbox" checked={chosen.has(f.path)} onChange={() => toggle(f.path)} disabled={busy} />
                <span className="pick__title">{f.name}</span>
                <span className="muted">
                  {formatSize(f.size)} · {new Date(f.updatedAt).toLocaleDateString()}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="modal__foot">
          <span className="muted">{chosen.size} selected</span>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => void submit()} disabled={busy || chosen.size === 0}>
            {busy ? 'Importing…' : `Import ${chosen.size || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
