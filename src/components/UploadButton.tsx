import { useRef, useState } from 'react';
import { api } from '../api';

export function UploadButton({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        await api.uploadTrack(file);
      } catch (e) {
        failures.push(`${file.name}: ${(e as Error).message}`);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      onUploaded();
    }
    setProgress(null);
    if (failures.length) setError(failures.join('\n'));
    if (inputRef.current) inputRef.current.value = '';
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
        {progress ? `Uploading ${progress.done}/${progress.total}…` : '⬆ Upload'}
      </button>
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}
