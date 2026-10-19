import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';

import { trpc } from '../init';
import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  getAdminRoleCapabilities,
  hasAdminCapability,
  isFullAdminRole,
} from './adminPermissions';

const readAdminUser = async (opts: any) => {
  const { ctx } = opts as any;
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
  if (!ctx.serverDB) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'serverDatabase middleware required before requireSuperAdmin',
    });
  }

  const user = await ctx.serverDB.query.users.findFirst({
    columns: { banned: true, role: true },
    where: eq(users.id, ctx.userId),
  });

  if (user?.banned) throw new TRPCError({ code: 'FORBIDDEN', message: 'banned' });

  return user;
};

const withAdminContext = (ctx: any, role: string | null | undefined) => ({
  ...ctx,
  adminCapabilities: getAdminRoleCapabilities(role),
  adminRole: role,
  isAdmin: true,
  isFullAdmin: isFullAdminRole(role),
});

export const requireSuperAdmin = trpc.middleware(async (opts) => {
  const { ctx } = opts as any;
  const user = await readAdminUser(opts);

  if (!hasAdminCapability(user?.role, ADMIN_CAPABILITIES.adminAccess)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'admin role required' });
  }

  return opts.next({
    ctx: withAdminContext(ctx, user?.role),
  });
});

export const requireAdminCapability = (capability: AdminCapability) =>
  trpc.middleware(async (opts) => {
    const { ctx } = opts as any;
    const user = await readAdminUser(opts);

    if (!hasAdminCapability(user?.role, capability)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `${capability} capability required` });
    }

    return opts.next({
      ctx: withAdminContext(ctx, user?.role),
    });
  });

export const requireAnyAdminCapability = (capabilities: readonly AdminCapability[]) =>
  trpc.middleware(async (opts) => {
    const { ctx } = opts as any;
    const user = await readAdminUser(opts);

    if (!capabilities.some((capability) => hasAdminCapability(user?.role, capability))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'required admin capability missing' });
    }

    return opts.next({
      ctx: withAdminContext(ctx, user?.role),
    });
  });
