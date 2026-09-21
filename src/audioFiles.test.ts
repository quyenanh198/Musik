import { describe, expect, it } from 'vitest';
import { asAudioFile } from './audioFiles';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('asAudioFile', () => {
  it('keeps files the browser already knows are audio', () => {
    const f = file('a.mp3', 'audio/mpeg');
    expect(asAudioFile(f)).toBe(f);
  });

  it('fills in the type from the extension when the browser reports none', () => {
    const fixed = asAudioFile(file('Song.FLAC', ''));
    expect(fixed?.type).toBe('audio/flac');
    expect(fixed?.name).toBe('Song.FLAC');
    expect(asAudioFile(file('x.opus', 'application/octet-stream'))?.type).toBe('audio/ogg');
  });

  it('refuses things that are not audio', () => {
    expect(asAudioFile(file('notes.txt', 'text/plain'))).toBeNull();
    expect(asAudioFile(file('photo.jpg', 'image/jpeg'))).toBeNull();
    expect(asAudioFile(file('mystery', ''))).toBeNull();
    expect(asAudioFile(file('archive.zip', ''))).toBeNull();
  });
});
