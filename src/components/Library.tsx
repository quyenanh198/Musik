import { useMemo, useState } from 'react';
import type { Playlist, Track } from '../../shared/types';
import type { ImportResult } from '../api';
import { useI18n } from '../I18nProvider';
import { describeImport } from '../importSummary';
import { usePlayer } from '../player/PlayerProvider';
import { defaultDirection, parseSort, SORT_KEYS, SORT_STORAGE_KEY, sortTracks, type SortKey, type SortState } from '../sort';
import { readStored, writeStored } from '../storage';
import { useToast } from '../toasts';
import { ImportPicker } from './ImportPicker';
import { TrackList, type CoverChange, type TrackPatch } from './TrackList';
import { UploadButton } from './UploadButton';

export type LoadStatus = 'loading' | 'ready' | 'error';

interface Props {
  tracks: Track[];
  status: LoadStatus;
  onRetry: () => void;
  playlists: Playlist[];
  onRefresh: () => void;
  /** AudioExtract results can be pulled in (server has AUDIOEXTRACT_URL). */
  canImport: boolean;
  onUploadFiles: (files: File[]) => void;
  onAddToPlaylist: (playlistId: number, tracks: Track[]) => void;
  onEdit: (track: Track, patch: TrackPatch, cover: CoverChange) => Promise<void>;
  onEditMany: (tracks: Track[], patch: TrackPatch, cover: File | null) => Promise<void>;
  onDelete: (track: Track) => void;
  onDeleteMany: (tracks: Track[]) => void;
}

export function Library({
  tracks,
  status,
  onRetry,
  playlists,
  onRefresh,
  canImport,
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
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false); // AudioExtract picker open
  const [sort, setSortState] = useState<SortState>(() => parseSort(readStored(SORT_STORAGE_KEY)));

  const setSort = (next: SortState) => {
    setSortState(next);
    writeStored(SORT_STORAGE_KEY, JSON.stringify(next));
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? tracks.filter((track) => [track.title, track.artist, track.album].some((s) => s.toLowerCase().includes(q))) : tracks;
    return sortTracks(matching, sort);
  }, [tracks, query, sort]);

  const afterImport = (result: ImportResult) => {
    setImporting(false);
    onRefresh();
    const { message, kind } = describeImport(t, result);
    notify(message, kind);
  };

  const emptyMessage = tracks.length === 0 ? t('library.empty') : t('library.noMatches');

  return (
    <section>
      <header className="section__header">
        <h1>{t('nav.library')}</h1>
        <input
          className="search"
          type="search"
          data-search
          placeholder={t('library.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('library.search')}
        />
        <div className="sort">
          <select
            className="select"
            value={sort.key}
            aria-label={t('sort.by')}
            onChange={(e) => setSort({ key: e.target.value as SortKey, direction: defaultDirection(e.target.value as SortKey) })}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`sort.${key}`)}
              </option>
            ))}
          </select>
          <button
            className="icon"
            onClick={() => setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            title={sort.direction === 'asc' ? t('sort.ascending') : t('sort.descending')}
            aria-label={sort.direction === 'asc' ? t('sort.ascending') : t('sort.descending')}
          >
            {sort.direction === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button className="btn btn--ghost" onClick={() => player.shufflePlay(visible)} disabled={visible.length === 0}>
          ⇄ {t('library.shuffle')}
        </button>
        <UploadButton onFiles={onUploadFiles} />
        {canImport && (
          <button className="btn btn--ghost" onClick={() => setImporting(true)}>
            ⤓ {t('import.fromAudioExtract')}
          </button>
        )}
      </header>
      {importing && <ImportPicker onClose={() => setImporting(false)} onDone={afterImport} />}
      {status === 'loading' && tracks.length === 0 ? (
        <p className="muted" role="status">
          {t('common.loading')}
        </p>
      ) : status === 'error' && tracks.length === 0 ? (
        <div>
          <p className="error" role="alert">
            {t('library.loadFailed')}
          </p>
          <button className="btn btn--ghost" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <TrackList
          tracks={visible}
          playlists={playlists}
          onAddToPlaylist={onAddToPlaylist}
          onEdit={onEdit}
          onEditMany={onEditMany}
          onDelete={onDelete}
          onDeleteMany={onDeleteMany}
          emptyMessage={emptyMessage}
        />
      )}
    </section>
  );
}
