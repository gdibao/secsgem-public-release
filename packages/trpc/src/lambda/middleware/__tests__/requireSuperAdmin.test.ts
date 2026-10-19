import { describe, expect, it, vi } from 'vitest';

import { trpc } from '../../init';
import { ADMIN_CAPABILITIES } from '../adminPermissions';
import {
  requireAdminCapability,
  requireAnyAdminCapability,
  requireSuperAdmin,
} from '../requireSuperAdmin';

const testRouter = trpc.router({
  contentRead: trpc.procedure
    .use(requireAdminCapability(ADMIN_CAPABILITIES.contentRead))
    .query(({ ctx }) => ({ adminRole: (ctx as any).adminRole })),
  finance: trpc.procedure
    .use(requireAdminCapability(ADMIN_CAPABILITIES.financeWrite))
    .query(({ ctx }) => ({
      adminCapabilities: (ctx as any).adminCapabilities,
      adminRole: (ctx as any).adminRole,
      isAdmin: (ctx as any).isAdmin,
      isFullAdmin: (ctx as any).isFullAdmin,
    })),
  financeOrAudit: trpc.procedure
    .use(
      requireAnyAdminCapability([
        ADMIN_CAPABILITIES.auditRead,
        ADMIN_CAPABILITIES.financeRead,
      ]),
    )
    .query(({ ctx }) => ({ adminRole: (ctx as any).adminRole })),
  ping: trpc.procedure.use(requireSuperAdmin).query(({ ctx }) => ({
    adminCapabilities: (ctx as any).adminCapabilities,
    adminRole: (ctx as any).adminRole,
    isAdmin: (ctx as any).isAdmin,
    isFullAdmin: (ctx as any).isFullAdmin,
  })),
});

const createCaller = trpc.createCallerFactory(testRouter);

const createServerDB = (user: { banned?: boolean; role?: string | null } | undefined) => ({
  query: {
    users: {
      findFirst: vi.fn().mockResolvedValue(user),
    },
  },
});

describe('requireSuperAdmin middleware', () => {
  it('keeps the existing admin role accepted and exposes admin capability context', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'admin' }),
      userId: 'admin-user',
    } as any);

    await expect(caller.ping()).resolves.toMatchObject({
      adminCapabilities: expect.arrayContaining([ADMIN_CAPABILITIES.adminAccess]),
      adminRole: 'admin',
      isAdmin: true,
      isFullAdmin: true,
    });
  });

  it('rejects scoped roles until a procedure requests their capability explicitly', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'finance_admin' }),
      userId: 'finance-user',
    } as any);

    await expect(caller.ping()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('accepts scoped roles when the procedure requests their capability', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'finance_admin' }),
      userId: 'finance-user',
    } as any);

    await expect(caller.finance()).resolves.toMatchObject({
      adminCapabilities: expect.arrayContaining([ADMIN_CAPABILITIES.financeWrite]),
      adminRole: 'finance_admin',
      isAdmin: true,
      isFullAdmin: false,
    });
  });

  it('accepts a scoped role for its read capability', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'content_admin' }),
      userId: 'content-user',
    } as any);

    await expect(caller.contentRead()).resolves.toEqual({ adminRole: 'content_admin' });
  });

  it('rejects scoped roles that do not have the requested capability', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'content_admin' }),
      userId: 'content-user',
    } as any);

    await expect(caller.finance()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('accepts any one capability from an explicit shared read boundary', async () => {
    const financeCaller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'finance_admin' }),
      userId: 'finance-user',
    } as any);
    const contentCaller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'content_admin' }),
      userId: 'content-user',
    } as any);

    await expect(financeCaller.financeOrAudit()).resolves.toEqual({
      adminRole: 'finance_admin',
    });
    await expect(contentCaller.financeOrAudit()).resolves.toEqual({
      adminRole: 'content_admin',
    });
  });

  it('rejects roles outside every capability on a shared read boundary', async () => {
    const caller = createCaller({
      serverDB: createServerDB({ banned: false, role: 'user' }),
      userId: 'regular-user',
    } as any);

    await expect(caller.financeOrAudit()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
