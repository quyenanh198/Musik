import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem, shiftFor } from './queueOrder';

describe('moveItem', () => {
  it('moves forwards and backwards without losing items', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves the list alone for a no-op or a bad index', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 5, 0)).toBe(list);
  });

  it('clamps a drop past the end instead of appending a hole', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a']);
  });
});

describe('dropIndex', () => {
  it('needs half a row of travel to pass a neighbour', () => {
    expect(dropIndex(1, 20, 60, 5)).toBe(1);
    expect(dropIndex(1, 31, 60, 5)).toBe(2);
    expect(dropIndex(1, -31, 60, 5)).toBe(0);
  });

  it('stays inside the queue and survives a zero row height', () => {
    expect(dropIndex(4, 500, 60, 5)).toBe(4);
    expect(dropIndex(0, -500, 60, 5)).toBe(0);
    expect(dropIndex(2, 100, 0, 5)).toBe(2);
  });
});

describe('shiftFor', () => {
  it('slides the passed-over rows the other way', () => {
    // Dragging row 0 down to 2: rows 1 and 2 step up, the dragged row spans two steps.
    expect(shiftFor(0, 0, 2)).toBe(2);
    expect(shiftFor(1, 0, 2)).toBe(-1);
    expect(shiftFor(2, 0, 2)).toBe(-1);
    expect(shiftFor(3, 0, 2)).toBe(0);
    // And upwards.
    expect(shiftFor(3, 3, 1)).toBe(-2);
    expect(shiftFor(1, 3, 1)).toBe(1);
    expect(shiftFor(0, 3, 1)).toBe(0);
  });
});
