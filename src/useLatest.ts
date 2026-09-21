import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A ref that always holds the value from the latest render, for handlers that are registered once (window listeners,
 * audio events, timers) but must not act on stale props. It is updated after render, in a layout effect, because
 * writing a ref while rendering is not safe under concurrent rendering.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
