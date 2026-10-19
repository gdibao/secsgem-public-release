import { randomUUID } from 'node:crypto';

import { hasAdminCapability } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { getActiveWorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EngineeringToolsModel } from '@/database/models/engineeringTools';
import { EngineeringToolsWorkspaceModel } from '@/database/models/engineeringToolsWorkspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

import { runRequiredAdminAuditMutation } from '../lambda-routers/admin/audit';
import {
  ratingRemoveSchema,
  ratingSchema,
  ratingToolSchema,
  ratingWriteSchema,
  reviewSchema,
  saveMyDraftSchema,
  type Submission,
  submissionRefSchema,
  submissionSchema,
} from './communitySchema';
import { engineeringToolSchema } from './schema';

const userProcedure = authedProcedure.use(serverDatabase);
const submissionsOwner = 'global';
function fail(code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND', message: string): never {
  throw new TRPCError({ code, message });
}

const activeUser = async (db: LobeChatDatabase, userId: string) => {
  const row = await db.query.users.findFirst({ columns: { banned: true }, where: eq(users.id, userId) });
  if (!row || row.banned) fail('FORBIDDEN', 'Inactive user');
};

const adminRoleFor = async (db: LobeChatDatabase, userId: string) => {
  const row = await db.query.users.findFirst({ columns: { banned: true, role: true }, where: eq(users.id, userId) });
  if (!row || row.banned) fail('FORBIDDEN', 'Inactive user');
  return row.role;
};

const scope = async (db: LobeChatDatabase, userId: string, workspaceId?: string | null) => {
  if (!workspaceId) return null;
  const role = await getActiveWorkspaceRole(db, workspaceId, userId);
  if (!role) fail('FORBIDDEN', 'Workspace access revoked');
  return role;
};

const readSubmissions = async (db: LobeChatDatabase) => {
  const rows = await new EngineeringToolsWorkspaceModel(db).list('submission', submissionsOwner);
  return rows.flatMap((row) => {
    const parsed = submissionSchema.safeParse(row.value);
    return parsed.success ? [parsed.data] : [];
  });
};

const canSeeSubmission = (item: Submission, workspaceId?: string | null) =>
  item.status === 'published' && (item.visibility === 'public' || item.workspaceId === workspaceId);

export const publishedSubmissions = async (db: LobeChatDatabase, workspaceId?: string | null) =>
  (await readSubmissions(db)).filter((item) => canSeeSubmission(item, workspaceId));

const visibleToolScope = async (db: LobeChatDatabase, toolId: string, workspaceId?: string | null) => {
  const curated = engineeringToolSchema.safeParse((await new EngineeringToolsModel(db).get(toolId))?.value);
  if (curated.success) return 'curated:public';
  const item = (await readSubmissions(db)).find((entry) => entry.toolId === toolId &&
    canSeeSubmission(entry, workspaceId));
  if (!item) fail('NOT_FOUND', 'Tool unavailable');
  return item.visibility === 'public' ? 'submission:public' : `submission:workspace:${item.workspaceId}`;
};

const ratingOwner = (toolScope: string, toolId: string) => `${toolScope}\0${toolId}`;
const moderator = async (db: LobeChatDatabase, userId: string, adminRole: string | null | undefined,
  item: Submission, workspaceId?: string | null) => {
  if (item.visibility === 'public') {
    if (!hasAdminCapability(adminRole, ADMIN_CAPABILITIES.moduleAppWrite)) fail('FORBIDDEN', 'Module reviewer required');
    return;
  }
  if (!workspaceId || item.workspaceId !== workspaceId) fail('FORBIDDEN', 'Wrong workspace');
  const role = await scope(db, userId, workspaceId);
  if (role !== 'admin' && role !== 'owner') fail('FORBIDDEN', 'Workspace reviewer required');
};

export const engineeringCommunityProcedures = {
  saveMyDraft: userProcedure.input(saveMyDraftSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    if (input.visibility === 'workspace' && !ctx.workspaceId) fail('BAD_REQUEST', 'Workspace required');
    return ctx.serverDB.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      await activeUser(db, ctx.userId);
      if (ctx.workspaceId) await scope(db, ctx.userId, ctx.workspaceId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const id = input.id ?? randomUUID();
      const current = input.id && await model.get('submission', submissionsOwner, id);
      if (input.id && !input.expectedVersion) fail('BAD_REQUEST', 'expectedVersion required');
      if (input.id && !current) fail('NOT_FOUND', 'Draft not found');
      const prior = current && submissionSchema.safeParse(current.value);
      if (current && (!prior || !prior.success)) fail('CONFLICT', 'Invalid draft');
      if (prior && prior.success && (prior.data.authorId !== ctx.userId ||
        (prior.data.visibility === 'workspace' && prior.data.workspaceId !== ctx.workspaceId) ||
        prior.data.visibility !== input.visibility))
        fail('FORBIDDEN', 'Draft scope mismatch');
      if (prior && prior.success && prior.data.status !== 'draft' && prior.data.status !== 'rejected')
        fail('FORBIDDEN', 'Submitted content is immutable');
      const now = new Date().toISOString();
      const value = submissionSchema.parse({ ...input, authorId: ctx.userId, createdAt: prior && prior.success ? prior.data.createdAt : now,
        id, parentId: prior && prior.success ? prior.data.parentId : null,
        parentVersion: prior && prior.success ? prior.data.parentVersion : null,
        reviewEvidence: null, reviewReason: null, reviewerId: null, status: 'draft',
        toolId: prior && prior.success ? prior.data.toolId : `UGC${id.replaceAll('-', '')}`,
        updatedAt: now, version: prior && prior.success ? prior.data.version + 1 : 1,
        workspaceId: input.visibility === 'workspace' ? ctx.workspaceId : null });
      const saved = current
        ? await model.replace('submission', submissionsOwner, id, input.expectedVersion!, value)
        : await model.create('submission', submissionsOwner, id, value);
      if (!saved) fail('CONFLICT', 'Draft changed concurrently');
      return { id, status: value.status, toolId: value.toolId, version: value.version };
    });
  }),
  startRevision: userProcedure.input(submissionRefSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return ctx.serverDB.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      await activeUser(db, ctx.userId);
      if (ctx.workspaceId) await scope(db, ctx.userId, ctx.workspaceId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const parent = submissionSchema.safeParse((await model.get('submission', submissionsOwner, input.id))?.value);
      if (!parent.success) fail('NOT_FOUND', 'Published item not found');
      const item = parent.data;
      if (item.authorId !== ctx.userId || (item.visibility === 'workspace' && item.workspaceId !== ctx.workspaceId))
        fail('FORBIDDEN', 'Publication scope mismatch');
      if (item.status !== 'published' || item.version !== input.expectedVersion)
        fail('CONFLICT', 'Published revision changed');
      if ((await readSubmissions(db)).some((entry) => entry.parentId === item.id &&
        ['draft', 'submitted', 'rejected'].includes(entry.status)))
        fail('CONFLICT', 'An editable revision already exists');
      const id = randomUUID();
      const now = new Date().toISOString();
      if (!await model.replace('submission', submissionsOwner, item.id, item.version,
        { ...item, updatedAt: now, version: item.version + 1 }))
        fail('CONFLICT', 'Published revision changed concurrently');
      const draft = submissionSchema.parse({ ...item, createdAt: now, id, parentId: item.id,
        parentVersion: item.version + 1, reviewEvidence: null, reviewReason: null, reviewerId: null,
        status: 'draft', updatedAt: now, version: 1 });
      if (!await model.create('submission', submissionsOwner, id, draft)) fail('CONFLICT', 'Revision ID collision');
      return { id, status: draft.status, toolId: draft.toolId, version: draft.version };
    });
  }),
  submitMyDraft: userProcedure.input(submissionRefSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return ctx.serverDB.transaction(async (tx) => {
      await activeUser(tx as LobeChatDatabase, ctx.userId);
      if (ctx.workspaceId) await scope(tx as LobeChatDatabase, ctx.userId, ctx.workspaceId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const parsed = submissionSchema.safeParse((await model.get('submission', submissionsOwner, input.id))?.value);
      if (!parsed.success) fail('NOT_FOUND', 'Draft not found');
      const item = parsed.data;
      if (item.authorId !== ctx.userId ||
        (item.visibility === 'workspace' && item.workspaceId !== ctx.workspaceId)) fail('FORBIDDEN', 'Draft scope mismatch');
      if (item.status !== 'draft') fail('FORBIDDEN', 'Only drafts may be submitted');
      const value = { ...item, status: 'submitted' as const, updatedAt: new Date().toISOString(), version: item.version + 1 };
      if (!await model.replace('submission', submissionsOwner, input.id, input.expectedVersion, value))
        fail('CONFLICT', 'Draft changed concurrently');
      if (item.workspaceId) await new WorkspaceAuditLogModel(tx as LobeChatDatabase).create({
        action: 'resource.updated', resourceId: item.id, resourceType: 'engineeringToolSubmission',
        userId: ctx.userId, workspaceId: item.workspaceId,
      });
      return { id: item.id, status: value.status, version: value.version };
    });
  }),
  listMySubmissions: userProcedure.query(async ({ ctx }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return (await readSubmissions(ctx.serverDB)).filter((item) => item.authorId === ctx.userId &&
      (item.visibility === 'public' || item.workspaceId === ctx.workspaceId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }),
  adminListPending: userProcedure.query(async ({ ctx }) => {
    const adminRole = await adminRoleFor(ctx.serverDB, ctx.userId);
    const role = await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const platform = hasAdminCapability(adminRole, ADMIN_CAPABILITIES.moduleAppWrite);
    if (!platform && role !== 'admin' && role !== 'owner') fail('FORBIDDEN', 'Reviewer required');
    return (await readSubmissions(ctx.serverDB)).filter((item) => item.status === 'submitted' &&
      (item.visibility === 'public' ? platform : item.workspaceId === ctx.workspaceId && (role === 'admin' || role === 'owner')));
  }),
  adminReview: userProcedure.input(reviewSchema).mutation(async ({ ctx, input }) => {
    const adminRole = await adminRoleFor(ctx.serverDB, ctx.userId);
    const row = await new EngineeringToolsWorkspaceModel(ctx.serverDB).get('submission', submissionsOwner, input.id);
    const parsed = submissionSchema.safeParse(row?.value);
    if (!parsed.success) fail('NOT_FOUND', 'Submission not found');
    await moderator(ctx.serverDB, ctx.userId, adminRole, parsed.data, ctx.workspaceId);
    if (input.decision === 'publish' && !input.evidence) fail('BAD_REQUEST', 'Publication evidence required');
    if (input.decision === 'publish') {
      const links = [parsed.data.officialWebsiteUrl, parsed.data.productUrl, parsed.data.runUrl,
        parsed.data.downloadUrl, parsed.data.purchaseUrl].filter((url): url is string => !!url);
      if (!parsed.data.officialWebsiteUrl && !parsed.data.productUrl)
        fail('BAD_REQUEST', 'An official product or website URL is required');
      if (links.some((url) => !input.evidence?.verifiedUrls.includes(url)))
        fail('BAD_REQUEST', 'Every published URL requires explicit review');
    }
    return runRequiredAdminAuditMutation(ctx, {
      audit: () => ({ action: `engineeringTool.submission.${input.decision}`, resourceId: input.id,
        resourceType: 'engineeringToolSubmission' }),
      mutation: async (tx) => {
        const db = tx as LobeChatDatabase;
        const model = new EngineeringToolsWorkspaceModel(tx);
        const current = submissionSchema.safeParse((await model.get('submission', submissionsOwner, input.id))?.value);
        if (!current.success) fail('NOT_FOUND', 'Submission not found');
        const item = current.data;
        await moderator(db, ctx.userId, await adminRoleFor(db, ctx.userId), item, ctx.workspaceId);
        if (item.status !== 'submitted') fail('CONFLICT', 'Not pending review');
        if (input.decision === 'publish') {
          const links = [item.officialWebsiteUrl, item.productUrl, item.runUrl,
            item.downloadUrl, item.purchaseUrl].filter((url): url is string => !!url);
          if (!item.officialWebsiteUrl && !item.productUrl ||
            links.some((url) => !input.evidence?.verifiedUrls.includes(url)))
            fail('BAD_REQUEST', 'Published links changed or lack review');
          if (await new EngineeringToolsModel(db).get(item.toolId))
            fail('CONFLICT', 'Canonical tool ID already exists');
          if (item.parentId) {
            const parent = submissionSchema.safeParse((await model.get('submission', submissionsOwner, item.parentId))?.value);
            if (!parent.success || parent.data.status !== 'published' || parent.data.version !== item.parentVersion ||
              parent.data.toolId !== item.toolId || parent.data.authorId !== item.authorId ||
              parent.data.workspaceId !== item.workspaceId)
              fail('CONFLICT', 'Parent publication changed');
            const retired = { ...parent.data, status: 'superseded' as const,
              updatedAt: new Date().toISOString(), version: parent.data.version + 1 };
            if (!await model.replace('submission', submissionsOwner, parent.data.id, parent.data.version, retired))
              fail('CONFLICT', 'Parent publication changed concurrently');
          }
        }
        const value = submissionSchema.parse({ ...item, reviewEvidence: input.evidence ?? null,
          reviewReason: input.reason, reviewerId: ctx.userId,
          status: input.decision === 'publish' ? 'published' : 'rejected',
          updatedAt: new Date().toISOString(), version: item.version + 1 });
        if (!await model.replace('submission', submissionsOwner, item.id, input.expectedVersion, value))
          fail('CONFLICT', 'Submission changed concurrently');
        if (item.workspaceId) await new WorkspaceAuditLogModel(db).create({
          action: 'resource.updated', resourceId: item.id, resourceType: 'engineeringToolSubmission',
          userId: ctx.userId, workspaceId: item.workspaceId,
        });
        return { id: item.id, status: value.status, toolId: item.toolId, version: value.version };
      },
    });
  }),
  getRatingSummary: userProcedure.input(ratingToolSchema).query(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const toolScope = await visibleToolScope(ctx.serverDB, input.toolId, ctx.workspaceId);
    const rows = await new EngineeringToolsWorkspaceModel(ctx.serverDB).list('rating', ratingOwner(toolScope, input.toolId));
    const ratings = rows.flatMap((row) => {
      const parsed = ratingSchema.safeParse(row.value);
      return parsed.success && parsed.data.toolId === input.toolId && parsed.data.score !== null ? [parsed.data.score] : [];
    });
    return { average: ratings.length ? ratings.reduce((sum, score) => sum + score, 0) / ratings.length : null,
      count: ratings.length };
  }),
  getMyRating: userProcedure.input(ratingToolSchema).query(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const toolScope = await visibleToolScope(ctx.serverDB, input.toolId, ctx.workspaceId);
    const row = await new EngineeringToolsWorkspaceModel(ctx.serverDB).get('rating', ratingOwner(toolScope, input.toolId), ctx.userId);
    const parsed = ratingSchema.safeParse(row?.value);
    return parsed.success ? { score: parsed.data.score, version: parsed.data.version } : null;
  }),
  upsertMyRating: userProcedure.input(ratingWriteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return ctx.serverDB.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      await activeUser(db, ctx.userId);
      if (ctx.workspaceId) await scope(db, ctx.userId, ctx.workspaceId);
      const toolScope = await visibleToolScope(db, input.toolId, ctx.workspaceId);
      const owner = ratingOwner(toolScope, input.toolId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const current = await model.get('rating', owner, ctx.userId);
      const parsed = current && ratingSchema.safeParse(current.value);
      if (current && (!parsed || !parsed.success)) fail('CONFLICT', 'Invalid rating');
      const version = parsed && parsed.success ? parsed.data.version + 1 : 1;
      const value = ratingSchema.parse({ score: input.score, toolId: input.toolId, userId: ctx.userId, version });
      const saved = current ? await model.replace('rating', owner, ctx.userId, input.expectedVersion, value)
        : input.expectedVersion === 0 && await model.create('rating', owner, ctx.userId, value);
      if (!saved) fail('CONFLICT', 'Rating changed concurrently');
      return { score: input.score, version };
    });
  }),
  removeMyRating: userProcedure.input(ratingRemoveSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await scope(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return ctx.serverDB.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      await activeUser(db, ctx.userId);
      if (ctx.workspaceId) await scope(db, ctx.userId, ctx.workspaceId);
      const toolScope = await visibleToolScope(db, input.toolId, ctx.workspaceId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const owner = ratingOwner(toolScope, input.toolId);
      const current = ratingSchema.safeParse((await model.get('rating', owner, ctx.userId))?.value);
      if (!current.success || current.data.score === null) fail('CONFLICT', 'Rating is not active');
      const version = current.data.version + 1;
      if (!await model.replace('rating', owner, ctx.userId, input.expectedVersion,
        { ...current.data, score: null, version })) fail('CONFLICT', 'Rating changed concurrently');
      return { removed: true, version };
    });
  }),
};
