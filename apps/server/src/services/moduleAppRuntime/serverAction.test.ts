import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleAppServerAction } from './serverAction';

const { createNotification } = vi.hoisted(() => ({
  createNotification: vi.fn(),
}));

vi.mock('@/database/models/notification', () => ({
  NotificationModel: class {
    create = createNotification;
  },
}));

describe('createModuleAppServerAction', () => {
  beforeEach(() => {
    createNotification.mockReset();
  });

  it('creates an idempotent user notification for the approved action', async () => {
    createNotification.mockResolvedValue({ id: 'notification-1' });
    const serverAction = createModuleAppServerAction({ db: {} as never });

    await expect(
      serverAction({
        actionKey: 'notifications.create',
        idempotencyKey: 'run-1',
        input: { actionUrl: '/apps/example', content: 'Finished', title: 'Module run' },
        installationId: 'installation-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      output: { notificationId: 'notification-1' },
      preview: 'Module run',
    });
    expect(createNotification).toHaveBeenCalledWith({
      actionUrl: '/apps/example',
      category: 'module_app',
      content: 'Finished',
      dedupeKey: 'installation-1:run-1',
      title: 'Module run',
      type: 'module_app_event',
    });
  });

  it('denies unapproved actions before touching notification storage', async () => {
    const serverAction = createModuleAppServerAction({ db: {} as never });

    await expect(
      serverAction({
        actionKey: 'users.delete',
        idempotencyKey: 'run-1',
        input: {},
        installationId: 'installation-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('MODULE_APP_SERVER_ACTION_DENIED');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it.each([
    [{ content: '', title: 'Empty content' }],
    [{ content: 'Finished', title: '' }],
    [{ actionUrl: 'https://attacker.example', content: 'Finished', title: 'External link' }],
    [{ actionUrl: '//attacker.example', content: 'Finished', title: 'Protocol-relative link' }],
  ])('rejects invalid notification input %#', async (input) => {
    const serverAction = createModuleAppServerAction({ db: {} as never });

    await expect(
      serverAction({
        actionKey: 'notifications.create',
        idempotencyKey: 'run-1',
        input,
        installationId: 'installation-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow();
    expect(createNotification).not.toHaveBeenCalled();
  });
});
