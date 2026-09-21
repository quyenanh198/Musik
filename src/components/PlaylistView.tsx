import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Playlist, PlaylistDetail, Track } from '../../shared/types';
import { api, type ImportResult } from '../api';
import { useI18n } from '../I18nProvider';
import { describeImport } from '../importSummary';
import { usePlayer } from '../player/PlayerProvider';
import { useToast } from '../toasts';
import { useDialogFocus } from '../useDialogFocus';
import { ImportPicker } from './ImportPicker';
import { TrackList, type CoverChange, type TrackPatch } from './TrackList';
import { UploadButton } from './UploadButton';

interface Props {
  id: number;
  playlists: Playlist[];
  /** Every library track — the "add from library" picker offers the ones not yet in this playlist. */
  library: Track[];
  /** Bumped by the parent whenever the track list was refreshed, so this playlist re-reads its tracks. */
  version: number;
  onPlaylistsChanged: () => void;
  onTracksChanged: () => void;
  canImport: boolean;
  onDeleted: () => void;
  /** Files picked here go into this playlist too (the app decides that from the page being shown). */
  onUploadFiles: (files: File[]) => void;
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => Promise<void>;
  onEdit: (track: Track, patch: TrackPatch, cover: CoverChange) => Promise<void>;
  onEditMany: (tracks: Track[], patch: TrackPatch, cover: File | null) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
}

export function PlaylistView({
  id,
  playlists,
  library,
  version,
  onPlaylistsChanged,
  onTracksChanged,
  canImport,
  onDeleted,
  onUploadFiles,
  onAddToPlaylist,
  onEdit,
  onEditMany,
  onDelete,
  onDeleteMany,
}: Props) {
  const player = usePlayer();
  const { t } = useI18n();
  const notify = useToast();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false); // AudioExtract picker open
  const otherPlaylists = useMemo(() => playlists.filter((p) => p.id !== id), [playlists, id]);

  // Only the newest response is applied, so a slow earlier request cannot overwrite a fresher list.
  const latestLoad = useRef(0);
  const load = useCallback(() => {
    const mine = ++latestLoad.current;
    api
      .getPlaylist(id)
      .then((d) => {
        if (mine !== latestLoad.current) return;
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine === latestLoad.current) setError(e.message);
      });
  }, [id]);

  useEffect(load, [load, version]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!detail) return <p className="muted" role="status">{t('common.loading')}</p>;

  const fail = (e: unknown) => notify((e as Error).message, 'error');

  const rename = async () => {
    const trimmed = name.trim();
    try {
      if (trimmed && trimmed !== detail.name) {
        await api.renamePlaylist(id, trimmed);
        onPlaylistsChanged();
        load();
      }
      setRenaming(false);
    } catch (e) {
      fail(e); // the form stays open with what was typed
    }
  };

  const remove = async () => {
    if (!confirm(t('confirm.deletePlaylist', { name: detail.name }))) return;
    try {
      await api.deletePlaylist(id);
      onPlaylistsChanged();
      onDeleted();
    } catch (e) {
      fail(e);
    }
  };

  const removeTracks = async (tracks: Track[]) => {
    try {
      if (tracks.length === 1) await api.removeFromPlaylist(id, tracks[0].id);
      else await api.removeManyFromPlaylist(id, tracks.map((track) => track.id));
      load();
      onPlaylistsChanged();
      if (tracks.length > 1) notify(t('toast.removedFromPlaylist', { n: tracks.length, name: detail.name }));
    } catch (e) {
      fail(e);
    }
  };

  const move = async (track: Track, toIndex: number) => {
    try {
      setDetail(await api.moveInPlaylist(id, track.id, toIndex));
    } catch (e) {
      fail(e);
      load(); // the list may have changed elsewhere; show what is really there
    }
  };

  const afterImport = (result: ImportResult) => {
    setImporting(false);
    onTracksChanged();
    onPlaylistsChanged();
    const { message, kind } = describeImport(t, result);
    notify(`${message} → ${detail.name}`, kind);
  };

  return (
    <section>
      <header className="section__header">
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus aria-label={t('playlist.nameLabel')} />
            <button className="btn" type="submit">
              {t('common.save')}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </button>
          </form>
        ) : (
          <h1>{detail.name}</h1>
        )}
        <span className="muted">{t('common.tracks', { n: detail.trackCount })}</span>
        <div className="section__actions">
          <button className="btn" onClick={() => player.playQueue(detail.tracks, 0)} disabled={detail.tracks.length === 0}>
            ▶ {t('playlist.playAll')}
          </button>
          <button className="btn btn--ghost" onClick={() => player.shufflePlay(detail.tracks)} disabled={detail.tracks.length === 0}>
            ⇄ {t('library.shuffle')}
          </button>
          <button className="btn btn--ghost" onClick={() => setPicking(true)}>
            + {t('playlist.addFromLibrary')}
          </button>
          <UploadButton onFiles={onUploadFiles} label={t('playlist.uploadHere')} />
          {canImport && (
            <button className="btn btn--ghost" onClick={() => setImporting(true)}>
              ⤓ {t('import.fromAudioExtract')}
            </button>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => {
              setName(detail.name);
              setRenaming(true);
            }}
          >
            {t('playlist.rename')}
          </button>
          <button className="btn btn--ghost" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        </div>
      </header>
      {importing && <ImportPicker playlistId={id} playlistName={detail.name} onClose={() => setImporting(false)} onDone={afterImport} />}
      {picking && (
        <LibraryPicker
          library={library}
          exclude={new Set(detail.tracks.map((track) => track.id))}
          onClose={() => setPicking(false)}
          onAdd={async (tracks) => {
            await onAddToPlaylist(id, tracks);
            setPicking(false);
            load();
          }}
        />
      )}
      <TrackList
        tracks={detail.tracks}
        playlists={otherPlaylists}
        onAddToPlaylist={(pid, tracks) => void onAddToPlaylist(pid, tracks)}
        onEdit={onEdit}
        onEditMany={onEditMany}
        onDelete={onDelete}
        onDeleteMany={onDeleteMany}
        onRemove={(track) => void removeTracks([track])}
        onRemoveMany={(tracks) => void removeTracks(tracks)}
        onMove={(track, toIndex) => void move(track, toIndex)}
        emptyMessage={t('playlist.empty')}
      />
    </section>
  );
}

/** Multi-select picker over the library for tracks not yet in the playlist. */
function LibraryPicker({
  library,
  exclude,
  onAdd,
  onClose,
}: {
  library: Track[];
  exclude: Set<number>;
  onAdd: (tracks: Track[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose, busy);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library
      .filter((track) => !exclude.has(track.id))
      .filter((track) => !q || [track.title, track.artist, track.album].some((s) => s.toLowerCase().includes(q)));
  }, [library, exclude, query]);

  const allShown = candidates.length > 0 && candidates.every((track) => chosen.has(track.id));
  const toggle = (id: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllShown = () =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (allShown) candidates.forEach((track) => next.delete(track.id));
      else candidates.forEach((track) => next.add(track.id));
      return next;
    });

  const submit = async () => {
    const tracks = library.filter((track) => chosen.has(track.id));
    if (tracks.length === 0) return;
    setBusy(true);
    try {
      await onAdd(tracks);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={t('picker.title')} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <strong>{t('picker.title')}</strong>
          <input
            className="search"
            type="search"
            placeholder={t('common.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('picker.search')}
            autoFocus
          />
          <label className="modal__all">
            <input type="checkbox" checked={allShown} onChange={toggleAllShown} disabled={candidates.length === 0} />
            {t('picker.allShown', { n: candidates.length })}
          </label>
        </div>
        <div className="modal__list">
          {candidates.length === 0 ? (
            <p className="muted">{library.length - exclude.size === 0 ? t('picker.allInPlaylist') : t('library.noMatches')}</p>
          ) : (
            candidates.map((track) => (
              <label key={track.id} className={`pick${chosen.has(track.id) ? ' pick--on' : ''}`}>
                <input type="checkbox" checked={chosen.has(track.id)} onChange={() => toggle(track.id)} />
                <span className="pick__title">{track.title}</span>
                <span className="muted">{track.artist || t('common.unknownArtist')}</span>
              </label>
            ))
          )}
        </div>
        <div className="modal__foot">
          <span className="muted">{t('picker.selected', { n: chosen.size })}</span>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn" onClick={() => void submit()} disabled={busy || chosen.size === 0}>
            {t('picker.add', { n: chosen.size || '' })}
          </button>
        </div>
      </div>
    </div>
  );
}
