// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '@/libs/trpc/lambda';

import {
  requireWorkspaceRoleWhenScoped,
  wsAdminProcedure,
  wsCompatProcedure,
  wsProcedure,
} from './workspaceAuth';

const mocks = vi.hoisted(() => {
  const state = { rows: [] as Array<{ role: string }> };
  const database = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => state.rows),
        })),
      })),
    })),
  };

  return { database, state };
});

vi.mock('@lobechat/database', () => ({ serverDB: mocks.database }));
vi.mock('@lobechat/database/schemas', () => ({
  workspaceMembers: { deletedAt: {}, role: {}, userId: {}, workspaceId: {} },
}));

const testRouter = router({
  admin: wsAdminProcedure.query(() => 'admin'),
  compat: wsCompatProcedure.query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceSlug: ctx.workspaceSlug,
  })),
  scopedWrite: wsCompatProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .mutation(() => 'written'),
  workspace: wsProcedure.query(() => 'workspace'),
});

describe('workspace authorization', () => {
  beforeEach(() => {
    mocks.state.rows = [];
    vi.clearAllMocks();
  });

  it('removes an unverified workspace header from compatibility procedures', async () => {
    const caller = testRouter.createCaller({
      userId: 'user-1',
      workspaceId: 'unverified-workspace',
    } as never);

    await expect(caller.compat()).resolves.toEqual({
      workspaceId: undefined,
      workspaceSlug: undefined,
    });
  });

  it('retains workspace scope for an active member', async () => {
    mocks.state.rows = [{ role: 'viewer' }];
    const caller = testRouter.createCaller({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as never);

    await expect(caller.compat()).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceSlug: undefined,
    });
    await expect(caller.workspace()).resolves.toBe('workspace');
  });

  it('enforces role hierarchy for workspace writes', async () => {
    mocks.state.rows = [{ role: 'member' }];
    const member = testRouter.createCaller({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as never);
    await expect(member.scopedWrite()).resolves.toBe('written');
    await expect(member.admin()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    mocks.state.rows = [{ role: 'owner' }];
    const owner = testRouter.createCaller({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as never);
    await expect(owner.admin()).resolves.toBe('admin');
  });

  it('keeps unscoped compatibility writes in personal scope', async () => {
    const caller = testRouter.createCaller({ userId: 'user-1' } as never);

    await expect(caller.scopedWrite()).resolves.toBe('written');
    expect(mocks.database.select).not.toHaveBeenCalled();
  });
});
