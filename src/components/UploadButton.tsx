import { useRef, useState } from 'react';
import type { Track } from '../../shared/types';
import { api } from '../api';

interface Props {
  /** Called after each file lands (with that track) so lists refresh as uploads go, and once at the end with all of them. */
  onUploaded: (tracks: Track[], done: boolean) => void;
  label?: string;
}

export function UploadButton({ onUploaded, label = '⬆ Upload' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    const failures: string[] = [];
    const uploaded: Track[] = [];
    for (const file of Array.from(files)) {
      try {
        const track = await api.uploadTrack(file);
        uploaded.push(track);
        onUploaded([track], false);
      } catch (e) {
        failures.push(`${file.name}: ${(e as Error).message}`);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    if (failures.length) setError(failures.join('\n'));
    if (inputRef.current) inputRef.current.value = '';
    onUploaded(uploaded, true);
  };

  return (
    <div className="upload">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <button className="btn" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
        {progress ? `Uploading ${progress.done}/${progress.total}…` : label}
      </button>
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}
