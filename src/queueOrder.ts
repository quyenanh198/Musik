/** Move one item inside a list, returning a new list. Out-of-range indices are clamped. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(items.length - 1, to)), 0, item);
  return next;
}

/**
 * Where a row dragged by `deltaY` pixels should land. Rows are a fixed step apart, so
 * half a step of travel is what moves the row past its neighbour.
 */
export function dropIndex(from: number, deltaY: number, rowStep: number, length: number): number {
  if (rowStep <= 0 || length === 0) return from;
  const moved = Math.round(deltaY / rowStep);
  return Math.max(0, Math.min(length - 1, from + moved));
}

/**
 * How far a row sitting at `index` shifts while another row is being dragged over it,
 * in whole row steps: the dragged row follows the finger, the rows it passes swap back.
 */
export function shiftFor(index: number, from: number, to: number): number {
  if (index === from) return to - from;
  if (from < to && index > from && index <= to) return -1;
  if (to < from && index >= to && index < from) return 1;
  return 0;
}
