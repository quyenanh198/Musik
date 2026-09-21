/**
 * The server accepts a file only when its multipart part says `audio/*`. Some browsers report an empty type for
 * formats the OS does not know (FLAC and Opus on older Windows setups), which would be refused as "not audio" even
 * though the bytes are fine, so the type is filled in from the extension.
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  mka: 'audio/x-matroska',
  weba: 'audio/webm',
};

/** The file ready to upload, with an audio type; null when it is clearly not audio. */
export function asAudioFile(file: File): File | null {
  if (file.type.startsWith('audio/')) return file;
  if (file.type !== '' && file.type !== 'application/octet-stream') return null;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPE_BY_EXTENSION[extension];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null;
}
