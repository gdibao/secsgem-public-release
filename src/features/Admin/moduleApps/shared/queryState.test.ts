import { describe, expect, it } from 'vitest';

import { advanceCursor, retreatCursor, setFilter } from './queryState';

describe('module app query state', () => {
  it('retains and restores opaque cursors as a repeated trail', () => {
    const first = advanceCursor(new URLSearchParams('status=draft'), 'cursor-2');

    expect(first.get('cursor')).toBe('cursor-2');
    expect(first.getAll('previousCursor')).toEqual(['']);

    const second = advanceCursor(first, 'opaque:cursor/with.punctuation');
    expect(second.getAll('previousCursor')).toEqual(['', 'cursor-2']);

    const previous = retreatCursor(second);
    expect(previous.get('cursor')).toBe('cursor-2');
    expect(previous.getAll('previousCursor')).toEqual(['']);

    const initial = retreatCursor(previous);
    expect(initial.get('cursor')).toBeNull();
    expect(initial.getAll('previousCursor')).toEqual([]);
  });

  it('clears the complete cursor trail when a filter changes', () => {
    const params = new URLSearchParams(
      'status=draft&cursor=cursor-3&previousCursor=&previousCursor=cursor-2',
    );

    const next = setFilter(params, 'status', 'published');

    expect(next.get('status')).toBe('published');
    expect(next.has('cursor')).toBe(false);
    expect(next.getAll('previousCursor')).toEqual([]);
    expect(params.get('cursor')).toBe('cursor-3');
  });

  it('deletes an empty filter while retaining unrelated query values', () => {
    const next = setFilter(new URLSearchParams('status=draft&sort=updated'), 'status', '');

    expect(next.has('status')).toBe(false);
    expect(next.get('sort')).toBe('updated');
  });
});
