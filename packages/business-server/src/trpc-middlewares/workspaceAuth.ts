import { serverDB } from '@lobechat/database';
import { workspaceMembers } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'admin' | 'member' | 'owner' | 'viewer';

const roleRank: Record<WorkspaceRole, number> = {
  admin: 2,
  member: 1,
  owner: 3,
  viewer: 0,
};

const isWorkspaceRole = (role: string): role is WorkspaceRole => Object.hasOwn(roleRank, role);

export const getActiveWorkspaceRole = async (
  db: LobeChatDatabase,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> => {
  const [membership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);

  return membership?.role && isWorkspaceRole(membership.role) ? membership.role : null;
};

const resolveDatabase = (ctx: Record<string, unknown>): LobeChatDatabase =>
  (ctx.serverDB as LobeChatDatabase | undefined) ?? serverDB;

const assertWorkspaceRole = async (
  ctx: Record<string, unknown>,
  minRole: WorkspaceRole,
): Promise<void> => {
  const workspaceId = typeof ctx.workspaceId === 'string' ? ctx.workspaceId : undefined;
  const userId = typeof ctx.userId === 'string' ? ctx.userId : undefined;

  if (!workspaceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
  }
  if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

  const role = await getActiveWorkspaceRole(resolveDatabase(ctx), workspaceId, userId);
  if (!role || roleRank[role] < roleRank[minRole]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient workspace access' });
  }
};

export const cloudWorkspaceAuth = trpc.middleware(async ({ ctx, next }) => {
  const workspaceId = ctx.workspaceId;

  if (!workspaceId || !ctx.userId) {
    return next({
      ctx: {
        workspaceId: undefined as string | undefined,
        workspaceSlug: undefined as string | undefined,
      },
    });
  }

  const role = await getActiveWorkspaceRole(resolveDatabase(ctx), workspaceId, ctx.userId);

  return next({
    ctx: {
      // Public-compatible procedures may continue in personal scope, but never with an
      // untrusted workspace header that is not backed by an active membership.
      workspaceId: role ? workspaceId : (undefined as string | undefined),
      workspaceSlug: undefined as string | undefined,
    },
  });
});

export const lobeWorkspaceAuth = trpc.middleware(async ({ ctx, next }) => {
  if (ctx.workspaceId) await assertWorkspaceRole(ctx, 'viewer');
  return next();
});

export const requireWorkspaceRole = (minRole: WorkspaceRole) =>
  trpc.middleware(async ({ ctx, next }) => {
    await assertWorkspaceRole(ctx, minRole);
    return next();
  });

export const requireWorkspaceRoleWhenScoped = (minRole: WorkspaceRole) =>
  trpc.middleware(async ({ ctx, next }) => {
    if (ctx.workspaceId) await assertWorkspaceRole(ctx, minRole);
    return next();
  });

const requireWorkspaceId = trpc.middleware(async ({ ctx, next }) => {
  if (!ctx.workspaceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
  }
  return next({ ctx: { workspaceId: ctx.workspaceId } });
});

export const wsProcedure = authedProcedure
  .use(requireWorkspaceId)
  .use(requireWorkspaceRole('viewer'));

export const wsMemberProcedure = authedProcedure
  .use(requireWorkspaceId)
  .use(requireWorkspaceRole('member'));

export const wsOwnerProcedure = authedProcedure
  .use(requireWorkspaceId)
  .use(requireWorkspaceRole('owner'));
export const wsAdminProcedure = authedProcedure
  .use(requireWorkspaceId)
  .use(requireWorkspaceRole('admin'));

export const wsCompatProcedure = authedProcedure.use(cloudWorkspaceAuth);
