import { normalizeVolume } from '../preferences';
import { readStored } from '../storage';

export const VOLUME_KEY = 'musik:volume';

let element: HTMLAudioElement | null = null;
let preloadElement: HTMLAudioElement | null = null;

/**
 * The one audio element of the app, created on first use. It is a single long-lived element on purpose: mobile
 * browsers only let an element play once a user gesture has "unlocked" it, and a new element per track would lose that.
 * It lives outside React because it is a mutable browser object, not state.
 */
export function getAudioElement(): HTMLAudioElement {
  if (!element) {
    element = new Audio();
    element.preload = 'metadata';
    element.volume = normalizeVolume(readStored(VOLUME_KEY));
  }
  return element;
}

/**
 * Dedicated preload audio element to pre-buffer the next track in the queue,
 * eliminating inter-track gap and latency.
 */
export function getPreloadAudioElement(): HTMLAudioElement {
  if (!preloadElement) {
    preloadElement = new Audio();
    preloadElement.preload = 'auto';
    preloadElement.volume = 0;
  }
  return preloadElement;
}

