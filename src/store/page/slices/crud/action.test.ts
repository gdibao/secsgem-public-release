import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageStore } from '../../store';
import { CrudActionImpl } from './action';

const createAction = () => {
  const createError = new Error('create failed');
  const navigate = vi.fn();
  const state = {
    createOptimisticPage: vi.fn(() => 'temp-page'),
    createPage: vi.fn().mockRejectedValue(createError),
    navigate,
    removeTempPage: vi.fn(),
  } as unknown as PageStore;
  const set = vi.fn();

  return {
    action: new CrudActionImpl(set as never, () => state),
    createError,
    navigate,
    state,
  };
};

describe('CrudActionImpl.createNewPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates to the page list when creation fails by default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { action, createError, navigate, state } = createAction();

    await expect(action.createNewPage('Untitled')).rejects.toThrow(createError);

    expect(state.removeTempPage).toHaveBeenCalledWith('temp-page');
    expect(navigate).toHaveBeenCalledWith('/page');
  });

  it('preserves the caller location when failure navigation is suppressed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { action, createError, navigate, state } = createAction();

    await expect(
      action.createNewPage('Untitled', { suppressFailureNavigation: true }),
    ).rejects.toThrow(createError);

    expect(state.removeTempPage).toHaveBeenCalledWith('temp-page');
    expect(navigate).not.toHaveBeenCalled();
  });
});
