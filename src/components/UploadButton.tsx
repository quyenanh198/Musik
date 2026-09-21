import { useRef } from 'react';
import { useI18n } from '../I18nProvider';
import { IconUpload } from './Icons';

interface Props {
  /** Files the user picked; the app-wide uploader takes it from here (progress, playlist, refresh). */
  onFiles: (files: File[]) => void;
  label?: string;
}

// `audio/*` is what most pickers understand; the extensions cover formats some operating systems do not know as audio.
const ACCEPT = 'audio/*,.flac,.opus,.m4a,.aac,.ogg,.oga,.wav,.mp3,.wma,.aiff,.aif';

export function UploadButton({ onFiles, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  return (
    <div className="upload">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = ''; // picking the same file again must still fire onChange
        }}
      />
      <button className="btn" onClick={() => inputRef.current?.click()}>
        <IconUpload size={16} /> {label ?? t('upload.button')}
      </button>
    </div>
  );
}
