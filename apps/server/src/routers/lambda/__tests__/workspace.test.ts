// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRouter } from '@/business/server/lambda-routers/workspace';

const listUserWorkspaces = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    listUserWorkspaces = listUserWorkspaces;
  },
}));

describe('workspaceRouter.getById', () => {
  beforeEach(() => listUserWorkspaces.mockReset());

  it('returns the membership-backed local workspace', async () => {
    listUserWorkspaces.mockResolvedValueOnce([
      { id: 'workspace-1', name: 'Engineering', role: 'owner', slug: 'engineering' },
    ]);
    const serverDB = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ role: 'owner' }] }),
        }),
      }),
    };
    const caller = workspaceRouter.createCaller({
      serverDB,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as never);

    await expect(caller.getById()).resolves.toMatchObject({
      id: 'workspace-1',
      role: 'owner',
      slug: 'engineering',
    });
  });

  it('lists only the authenticated user memberships from WorkspaceModel', async () => {
    listUserWorkspaces.mockResolvedValueOnce([
      { id: 'workspace-1', name: 'Engineering', role: 'member', slug: 'engineering' },
    ]);
    const caller = workspaceRouter.createCaller({ serverDB: {}, userId: 'user-1' } as never);

    await expect(caller.list()).resolves.toEqual([
      { id: 'workspace-1', name: 'Engineering', role: 'member', slug: 'engineering' },
    ]);
  });
});
