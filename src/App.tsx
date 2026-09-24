import { useCallback, useEffect, useRef, useState } from 'react';
import type { Playlist, Track } from '../shared/types';
import { api } from './api';
import { IconPlus } from './components/Icons';
import { Library, type LoadStatus } from './components/Library';
import { PlayerBar } from './components/PlayerBar';
import { PlaylistView } from './components/PlaylistView';
import type { CoverChange, TrackPatch } from './components/TrackList';
import { UploadStatus } from './components/UploadStatus';
import { useI18n } from './I18nProvider';
import { LANGS, type Lang } from './i18n';
import { usePlayer } from './player/PlayerProvider';
import { applyTheme, normalizeTheme, THEME_KEY, type ThemePreference } from './preferences';
import { resolveShortcut, SEEK_STEP } from './shortcuts';
import { readStored, writeStored } from './storage';
import { useToast } from './toasts';
import { useLatest } from './useLatest';
import { useUploader } from './useUploader';

type View = { kind: 'library' } | { kind: 'playlist'; id: number }; // which page is showing

const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', vi: 'Tiếng Việt' };

export function App() {
  const player = usePlayer();
  const { t, lang, setLang } = useI18n();
  const notify = useToast();
  const [view, setView] = useState<View>({ kind: 'library' });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksStatus, setTracksStatus] = useState<LoadStatus>('loading');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [version, setVersion] = useState(0);
  const [newPlaylistName, setNewPlaylistName] = useState<string | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => normalizeTheme(readStored(THEME_KEY)));

  // Handlers registered once (keyboard, drag-and-drop, uploads) read the latest player and page through refs.
  const playerRef = useLatest(player);
  const viewRef = useLatest(view);

  useEffect(() => {
    applyTheme(theme);
    writeStored(THEME_KEY, theme);
    if (theme !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme('system');
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [theme]);

  const fail = useCallback((e: unknown) => notify((e as Error).message, 'error'), [notify]);

  // Only the newest response wins: a slow earlier request must not overwrite a fresher list.
  const tracksRequest = useRef(0);
  const restoredSession = useRef(false);
  const refreshTracks = useCallback(() => {
    const mine = ++tracksRequest.current;
    api
      .listTracks()
      .then((list) => {
        if (mine !== tracksRequest.current) return;
        setTracks(list);
        setTracksStatus('ready');
        setVersion((v) => v + 1); // playlists showing tracks re-read them once the library is current
        if (!restoredSession.current) {
          restoredSession.current = true;
          playerRef.current.restore(list);
        }
      })
      .catch((e: Error) => {
        if (mine !== tracksRequest.current) return;
        setTracksStatus((status) => (status === 'ready' ? status : 'error'));
        fail(e);
      });
  }, [fail, playerRef]);

  const playlistsRequest = useRef(0);
  const refreshPlaylists = useCallback(() => {
    const mine = ++playlistsRequest.current;
    api
      .listPlaylists()
      .then((list) => {
        if (mine === playlistsRequest.current) setPlaylists(list);
      })
      .catch(fail);
  }, [fail]);

  const retryTracks = () => {
    setTracksStatus('loading');
    refreshTracks();
  };

  useEffect(() => {
    refreshTracks();
    refreshPlaylists();
    api
      .importSources()
      .then((s) => setCanImport(s.audioextract))
      .catch(() => setCanImport(false));
  }, [refreshTracks, refreshPlaylists]);

  // One upload queue for the button and for drag-and-drop; while a playlist is open, new tracks go into it as they land.
  const uploader = useUploader({
    onTrack: async (track) => {
      const page = viewRef.current;
      if (page.kind === 'playlist') {
        try {
          await api.addToPlaylist(page.id, [track.id]);
        } catch (e) {
          fail(e);
        }
      }
      refreshTracks();
    },
    onFinish: ({ uploaded, skipped }) => {
      refreshPlaylists();
      const parts = [];
      if (uploaded.length > 0) parts.push(t('toast.uploaded', { n: uploaded.length }));
      if (skipped.length > 0) parts.push(t('toast.uploadSkipped', { n: skipped.length }));
      if (parts.length > 0) notify(parts.join(' · '));
    },
  });
  const uploadFiles = uploader.enqueue;

  // Drop audio files anywhere on the page to upload them.
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault(); // without this the browser refuses the drop
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      uploadFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [uploadFiles]);

  // Keyboard shortcuts (space, arrows, N/P, M, /). Typing, focused buttons and open dialogs keep their own keys.
  useEffect(() => {
    // How focus got where it is: a press with the pointer means the focused button was merely clicked, Tab means the
    // user walked to it. (`:focus-visible` cannot tell: the browser flips it on the very key press being handled.)
    let keyboardFocus = false;
    const onPointer = () => {
      keyboardFocus = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') keyboardFocus = true;
      const target = e.target as HTMLElement | null;
      const action = resolveShortcut(e, { tag: target?.tagName ?? '', editable: Boolean(target?.isContentEditable), keyboardFocus }, document.querySelector('.modal-backdrop') !== null);
      if (!action) return;
      e.preventDefault();
      const p = playerRef.current;
      switch (action) {
        case 'toggle':
          p.toggle();
          break;
        case 'seekBack':
          p.seekBy(-SEEK_STEP);
          break;
        case 'seekForward':
          p.seekBy(SEEK_STEP);
          break;
        case 'next':
          p.next();
          break;
        case 'previous':
          p.prev();
          break;
        case 'mute':
          p.toggleMute();
          break;
        case 'search':
          document.querySelector<HTMLInputElement>('[data-search]')?.focus();
          break;
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [playerRef]);

  // Tell the user when a track cannot be played (deleted file, broken audio) instead of going silent.
  const reportedError = useRef(0);
  useEffect(() => {
    const failure = player.playbackError;
    if (!failure || failure.nonce === reportedError.current) return;
    reportedError.current = failure.nonce;
    notify(t('toast.playbackError', { title: failure.title }), 'error');
  }, [player.playbackError, notify, t]);

  // The tab title shows what is playing.
  const nowPlaying = player.current;
  const isPlaying = player.playing;
  useEffect(() => {
    document.title = nowPlaying ? `${isPlaying ? '▶ ' : ''}${nowPlaying.title} · Musik` : 'Musik';
  }, [nowPlaying, isPlaying]);

  const createPlaylist = async () => {
    const name = newPlaylistName?.trim();
    if (!name) return;
    try {
      const created = await api.createPlaylist(name);
      setNewPlaylistName(null);
      refreshPlaylists();
      setView({ kind: 'playlist', id: created.id });
    } catch (e) {
      fail(e);
    }
  };

  const addToPlaylist = async (playlistId: number, toAdd: Track[]) => {
    if (toAdd.length === 0) return;
    try {
      const before = playlists.find((p) => p.id === playlistId);
      const detail = await api.addToPlaylist(
        playlistId,
        toAdd.map((track) => track.id),
      );
      refreshPlaylists();
      const added = before ? detail.trackCount - before.trackCount : toAdd.length;
      const name = detail.name;
      notify(
        toAdd.length === 1
          ? added > 0
            ? t('toast.addedOne', { title: toAdd[0].title, name })
            : t('toast.alreadyIn', { title: toAdd[0].title, name })
          : added < toAdd.length
            ? t('toast.addedManySome', { added, total: toAdd.length, name })
            : t('toast.addedMany', { added, total: toAdd.length, name }),
      );
    } catch (e) {
      fail(e);
    }
  };

  // Bulk editing: errors propagate so the form can show them and keep what was typed. The list is refreshed either
  // way, because a patch may have been applied before a later step (the cover) failed.
  const editMany = async (toEdit: Track[], patch: TrackPatch, cover: File | null) => {
    if (toEdit.length === 0) return;
    const ids = toEdit.map((track) => track.id);
    try {
      let updated: Track[] = [];
      if (Object.keys(patch).length > 0) updated = await api.updateTracks(ids, patch);
      if (cover) updated = await api.setCoverMany(ids, cover);
      updated.forEach((track) => player.updateTrack(track));
      notify(t('toast.updated', { n: updated.length }));
    } finally {
      refreshTracks();
    }
  };

  const deleteMany = async (toDelete: Track[]) => {
    if (toDelete.length === 0) return;
    if (!confirm(t('confirm.deleteMany', { n: toDelete.length }))) return;
    try {
      const { deleted } = await api.deleteTracks(toDelete.map((track) => track.id));
      toDelete.forEach((track) => player.removeTrack(track.id));
      refreshTracks();
      refreshPlaylists();
      notify(t('toast.deleted', { n: deleted }));
    } catch (e) {
      fail(e);
    }
  };

  // Editor errors propagate so the dialog can show them and stay open.
  const editTrack = async (track: Track, patch: TrackPatch, cover: CoverChange) => {
    try {
      let updated = await api.updateTrack(track.id, patch);
      if (cover.kind === 'set') updated = await api.uploadCover(track.id, cover.file);
      else if (cover.kind === 'remove') updated = await api.deleteCover(track.id);
      player.updateTrack(updated);
    } finally {
      refreshTracks();
    }
  };

  const deleteTrack = async (track: Track) => {
    if (!confirm(t('confirm.deleteOne', { title: track.title }))) return;
    try {
      await api.deleteTrack(track.id);
      player.removeTrack(track.id);
      refreshTracks();
      refreshPlaylists();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t('nav.label')}>
        <div className="brand">
          <img className="brand__mark" src="/logo-mark.svg" alt="" />
          <span>Musik</span>
        </div>
        <button
          className={`nav ${view.kind === 'library' ? 'nav--active' : ''}`}
          aria-current={view.kind === 'library' ? 'page' : undefined}
          onClick={() => setView({ kind: 'library' })}
        >
          {t('nav.library')}
        </button>
        <div className="sidebar__heading">
          <span>{t('nav.playlists')}</span>
          <button className="icon" onClick={() => setNewPlaylistName('')} title={t('playlist.new')} aria-label={t('playlist.new')}>
            <IconPlus size={16} />
          </button>
        </div>
        {newPlaylistName !== null && (
          <form
            className="inline-form sidebar__new"
            onSubmit={(e) => {
              e.preventDefault();
              void createPlaylist();
            }}
          >
            <input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNewPlaylistName(null)}
              placeholder={t('playlist.namePlaceholder')}
              aria-label={t('playlist.newNameLabel')}
              maxLength={200}
              autoFocus
            />
            <button className="btn" type="submit" disabled={!newPlaylistName.trim()}>
              {t('common.add')}
            </button>
          </form>
        )}
        {playlists.map((pl) => {
          const active = view.kind === 'playlist' && view.id === pl.id;
          return (
            <button
              key={pl.id}
              className={`nav ${active ? 'nav--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setView({ kind: 'playlist', id: pl.id })}
            >
              {pl.name} <span className="muted">({pl.trackCount})</span>
            </button>
          );
        })}
        <div className="theme-picker">
          <label>
            <span>{t('prefs.theme')}</span>
            <select value={theme} onChange={(event) => setTheme(normalizeTheme(event.target.value))} aria-label={t('prefs.theme')}>
              <option value="system">{t('theme.system')}</option>
              <option value="light">{t('theme.light')}</option>
              <option value="dark">{t('theme.dark')}</option>
            </select>
          </label>
          <label>
            <span>{t('prefs.language')}</span>
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label={t('prefs.language')}>
              {LANGS.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </nav>

      <main className="main">
        <UploadStatus state={uploader.state} onDismiss={uploader.dismissFailures} />
        {view.kind === 'library' ? (
          <Library
            tracks={tracks}
            status={tracksStatus}
            onRetry={retryTracks}
            playlists={playlists}
            onRefresh={refreshTracks}
            canImport={canImport}
            onUploadFiles={uploadFiles}
            onAddToPlaylist={(pid, ts) => void addToPlaylist(pid, ts)}
            onEdit={editTrack}
            onEditMany={editMany}
            onDelete={deleteTrack}
            onDeleteMany={(ts) => void deleteMany(ts)}
          />
        ) : (
          <PlaylistView
            key={view.id}
            id={view.id}
            playlists={playlists}
            library={tracks}
            version={version}
            onPlaylistsChanged={refreshPlaylists}
            onTracksChanged={refreshTracks}
            canImport={canImport}
            onDeleted={() => setView({ kind: 'library' })}
            onUploadFiles={uploadFiles}
            onAddToPlaylist={addToPlaylist}
            onEdit={editTrack}
            onEditMany={editMany}
            onDelete={deleteTrack}
            onDeleteMany={(ts) => void deleteMany(ts)}
          />
        )}
      </main>

      <PlayerBar />
      {dragging && (
        <div className="dropzone" aria-hidden>
          <div className="dropzone__box">{t('upload.drop')}</div>
        </div>
      )}
    </div>
  );
}
