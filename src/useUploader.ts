import { useCallback, useRef, useState } from 'react';
import type { Track } from '../shared/types';
import { api } from './api';
import { asAudioFile } from './audioFiles';
import { useLatest } from './useLatest';

export interface UploadFailure {
  name: string;
  /** Server or network message; absent when the file was refused locally as not being audio. */
  error?: string;
}

export interface UploadState {
  active: boolean;
  total: number;
  done: number;
  currentName: string | null;
  /** 0 to 1 for the file being sent. */
  fraction: number;
  failures: UploadFailure[];
}

const IDLE: UploadState = { active: false, total: 0, done: 0, currentName: null, fraction: 0, failures: [] };

export interface UploaderHandlers {
  /** Called as each file lands, so lists fill up while the rest are still going. */
  onTrack: (track: Track) => Promise<void> | void;
  onFinish: (result: { uploaded: Track[]; failures: UploadFailure[] }) => void;
}

class NotAudioError extends Error {}

/**
 * One upload queue for the whole app (button and drag-and-drop alike): files go up one at a time with real byte
 * progress, files added while it is running join the same queue, and failures are kept until dismissed.
 */
export function useUploader(handlers: UploaderHandlers) {
  const [state, setState] = useState<UploadState>(IDLE);
  const pending = useRef<File[]>([]);
  const running = useRef(false);
  const handlersRef = useLatest(handlers);

  const run = useCallback(async () => {
    const uploaded: Track[] = [];
    const failures: UploadFailure[] = [];
    while (pending.current.length > 0) {
      const file = pending.current.shift() as File;
      setState((s) => ({ ...s, currentName: file.name, fraction: 0 }));
      try {
        const audio = asAudioFile(file);
        if (!audio) throw new NotAudioError();
        const track = await api.uploadTrack(audio, (fraction) => setState((s) => ({ ...s, fraction })));
        uploaded.push(track);
        await handlersRef.current.onTrack(track);
      } catch (e) {
        failures.push({ name: file.name, error: e instanceof NotAudioError ? undefined : (e as Error).message });
      }
      setState((s) => ({ ...s, done: s.done + 1 }));
    }
    running.current = false;
    setState((s) => ({ ...s, active: false, currentName: null, fraction: 0, failures: [...s.failures, ...failures] }));
    handlersRef.current.onFinish({ uploaded, failures });
  }, [handlersRef]);

  const enqueue = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      pending.current.push(...files);
      if (running.current) {
        setState((s) => ({ ...s, total: s.total + files.length }));
        return;
      }
      running.current = true;
      setState((s) => ({ ...IDLE, active: true, total: files.length, failures: s.failures }));
      void run();
    },
    [run],
  );

  const dismissFailures = useCallback(() => setState((s) => ({ ...s, failures: [] })), []);

  return { state, enqueue, dismissFailures };
}
