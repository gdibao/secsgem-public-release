import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const blocker = vi.hoisted(() => ({ proceed: vi.fn(), reset: vi.fn(), state: 'unblocked' }));
const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('react-router', () => ({ useBlocker: () => blocker }));
vi.mock('@lobehub/ui/base-ui', () => ({ confirmModal: confirmModalMock }));

const options = {
  cancelText: 'Keep editing',
  confirmText: 'Discard',
  isDirty: true,
  message: 'Discard changes?',
  title: 'Unsaved changes',
};

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    blocker.proceed.mockReset();
    blocker.reset.mockReset();
    blocker.state = 'unblocked';
    confirmModalMock.mockReset();
  });

  it('keeps the user on the form when navigation is cancelled', async () => {
    blocker.state = 'blocked';
    confirmModalMock.mockImplementation(({ onCancel }) => onCancel?.());

    renderHook(() => useUnsavedChangesGuard(options));

    await waitFor(() => expect(blocker.reset).toHaveBeenCalledOnce());
    expect(blocker.proceed).not.toHaveBeenCalled();
    expect(confirmModalMock).toHaveBeenCalledWith({
      cancelText: options.cancelText,
      content: options.message,
      okText: options.confirmText,
      onCancel: expect.any(Function),
      onOk: expect.any(Function),
      title: options.title,
    });
  });

  it('proceeds after confirmation and protects beforeunload', async () => {
    blocker.state = 'blocked';
    confirmModalMock.mockImplementation(({ onOk }) => onOk?.());

    renderHook(() => useUnsavedChangesGuard(options));
    await waitFor(() => expect(blocker.proceed).toHaveBeenCalledOnce());

    const event = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });
});
