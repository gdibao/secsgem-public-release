import { serverDB } from '@lobechat/database';
import {
  account,
  users,
  type WorkspaceInvitationItem,
  type WorkspaceMemberItem,
  workspaces,
} from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  getActiveWorkspaceRole,
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { UserModel } from '@/database/models/user';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

/** A membership row joined with the public profile of the member. */
export interface WorkspaceMemberSummary extends WorkspaceMemberItem {
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
}

// Cloud gates these on the compat procedure plus a role check rather than on a
// procedure that requires the header, so an unscoped call reads as empty rather
// than as a bad request. Mirror that here.
const wsCompatAdminProcedure = wsCompatProcedure.use(requireWorkspaceRole('admin'));
const wsCompatAdminMutationProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(requireWorkspaceRole('admin'));

const managedWorkspace = async (db: LobeChatDatabase, workspaceId: string, actorId: string) => {
  const [workspace] = await db
    .select({ primaryOwnerId: workspaces.primaryOwnerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });

  const role = await getActiveWorkspaceMembershipRole(db, { userId: actorId, workspaceId });
  if (role !== 'owner' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient workspace access' });
  }
  return { ownerId: workspace.primaryOwnerId, role };
};

const memberMutationInput = z.object({ userId: z.string().min(1) });
const memberRole = z.enum(['admin', 'member', 'viewer']);

// Member reads use the local workspace. Invitation management remains cloud-only.
export const workspaceMemberRouter = router({
  lookupByUserId: wsCompatAdminProcedure
    .use(serverDatabase)
    .input(memberMutationInput)
    .query(async ({ ctx, input }) => {
      const db: LobeChatDatabase = ctx.serverDB;
      const user = await db.query.users.findFirst({
        columns: { banned: true, id: true },
        where: eq(users.id, input.userId),
      });
      const linkedAccount =
        user &&
        (await db.query.account.findFirst({
          columns: { id: true },
          where: and(eq(account.userId, input.userId), eq(account.providerId, 'casdoor')),
        }));
      if (!user || user.banned || !linkedAccount) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'OIDC user not found' });
      }

      const [profile] = await UserModel.getDisplayInfoByIds(db, [input.userId]);
      return {
        user: profile
          ? { avatar: profile.avatar, fullName: profile.fullName, username: profile.username }
          : null,
        userId: input.userId,
      };
    }),

  addByUserId: wsCompatAdminMutationProcedure
    .input(memberMutationInput.extend({ role: memberRole.default('member') }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId!;
      const db: LobeChatDatabase = ctx.serverDB;
      return db.transaction(async (tx) => {
        const scope = await managedWorkspace(tx, workspaceId, ctx.userId);
        if (input.role === 'admin' && scope.role !== 'owner') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can grant admin' });
        }

        const user = await tx.query.users.findFirst({
          columns: { banned: true, id: true },
          where: eq(users.id, input.userId),
        });
        const linkedAccount =
          user &&
          (await tx.query.account.findFirst({
            columns: { id: true },
            where: and(eq(account.userId, input.userId), eq(account.providerId, 'casdoor')),
          }));
        if (!user || user.banned || !linkedAccount) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'OIDC user not found' });
        }

        const model = new WorkspaceMemberModel(tx, ctx.userId);
        if (await model.getMemberForUpdate(workspaceId, input.userId)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'User is already a member' });
        }
        const member = await model.addMember({ ...input, workspaceId });
        await new WorkspaceAuditLogModel(tx).create({
          action: 'member.joined',
          metadata: { role: input.role },
          resourceId: input.userId,
          resourceType: 'member',
          userId: ctx.userId,
          workspaceId,
        });
        return member;
      });
    }),

  changeRoleByUserId: wsCompatAdminMutationProcedure
    .input(memberMutationInput.extend({ role: memberRole }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId!;
      const db: LobeChatDatabase = ctx.serverDB;
      return db.transaction(async (tx) => {
        const scope = await managedWorkspace(tx, workspaceId, ctx.userId);
        if (input.userId === scope.ownerId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner role cannot be changed here' });
        }
        const model = new WorkspaceMemberModel(tx, ctx.userId);
        const current = await model.getMemberForUpdate(workspaceId, input.userId);
        if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        if ((current.role === 'admin' || input.role === 'admin') && scope.role !== 'owner') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can change admins' });
        }
        if (current.role === 'owner') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner role cannot be changed here' });
        }
        if (current.role === input.role) return current;

        await model.updateMemberRole(workspaceId, input.userId, input.role);
        await new WorkspaceAuditLogModel(tx).create({
          action: 'member.role_updated',
          metadata: { from: current.role, to: input.role },
          resourceId: input.userId,
          resourceType: 'member',
          userId: ctx.userId,
          workspaceId,
        });
        return { ...current, role: input.role };
      });
    }),

  revokeByUserId: wsCompatAdminMutationProcedure
    .input(memberMutationInput)
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId!;
      const db: LobeChatDatabase = ctx.serverDB;
      return db.transaction(async (tx) => {
        const scope = await managedWorkspace(tx, workspaceId, ctx.userId);
        if (input.userId === scope.ownerId || input.userId === ctx.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Owner or self-removal is not allowed here',
          });
        }
        const model = new WorkspaceMemberModel(tx, ctx.userId);
        const current = await model.getMemberForUpdate(workspaceId, input.userId);
        if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        if (current.role === 'owner' || (current.role === 'admin' && scope.role !== 'owner')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Insufficient member management access',
          });
        }

        const result = await model.removeMember(workspaceId, input.userId);
        await new WorkspaceAuditLogModel(tx).create({
          action: 'member.removed',
          metadata: { previousRole: current.role },
          resourceId: input.userId,
          resourceType: 'member',
          userId: ctx.userId,
          workspaceId,
        });
        return result;
      });
    }),
  invite: wsCompatAdminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
      }),
    )
    .mutation(async (): Promise<WorkspaceInvitationItem> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace invitations are a cloud-only feature.',
      });
    }),

  list: wsCompatProcedure
    .input(z.object({ includeDeleted: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }): Promise<WorkspaceMemberSummary[]> => {
      if (!ctx.workspaceId || !ctx.userId) return [];

      const db = (ctx as typeof ctx & { serverDB?: typeof serverDB }).serverDB ?? serverDB;
      const includeDeleted = input?.includeDeleted === true;
      if (includeDeleted) {
        const role = await getActiveWorkspaceRole(db, ctx.workspaceId, ctx.userId);
        if (role !== 'owner' && role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient workspace access' });
        }
      }

      const members = await new WorkspaceMemberModel(db, ctx.userId).listMembers(ctx.workspaceId, {
        includeDeleted,
      });
      if (members.length === 0) return [];

      const profiles = await UserModel.getDisplayInfoByIds(
        db,
        members.map((member) => member.userId),
      );
      const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

      return members.map((member) => {
        const profile = profilesById.get(member.userId);
        return {
          deletedAt: member.deletedAt,
          joinedAt: member.joinedAt,
          role: member.role,
          updatedAt: member.updatedAt,
          user: profile
            ? {
                avatar: profile.avatar,
                email: null,
                fullName: profile.fullName,
                username: profile.username,
              }
            : null,
          userId: member.userId,
          workspaceId: member.workspaceId,
        };
      });
    }),

  listInvitations: wsCompatAdminProcedure.query(async (): Promise<WorkspaceInvitationItem[]> => []),
});
