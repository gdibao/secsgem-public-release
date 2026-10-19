import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { getActiveWorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EngineeringToolsModel } from '@/database/models/engineeringTools';
import { EngineeringToolsWorkspaceModel } from '@/database/models/engineeringToolsWorkspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

import { recordAdminAudit, runRequiredAdminAuditMutation } from '../lambda-routers/admin/audit';
import { engineeringToolSchema } from './schema';
import {
  type CollectionDelete,
  collectionDeleteSchema,
  type CollectionWrite,
  collectionWriteSchema,
  configuredEndpointRevision,
  endpointDisableSchema,
  endpointLaunchable,
  endpointUnavailableReason,
  endpointWriteSchema,
  type EngineeringCollection,
  engineeringCollectionSchema,
  type EngineeringEndpoint,
  engineeringEndpointSchema,
  legacyEndpointRevision,
  panelStateSchema,
  panelStateWriteSchema,
  resolveLaunchSchema,
  toolAuditSchema,
  type ToolEndpointSummary,
} from './workspaceSchema';

const userProcedure = authedProcedure.use(serverDatabase);
const endpointOwner = 'global';
function failure(code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND', message: string): never {
  throw new TRPCError({ code, message });
}

const activeUser = async (db: LobeChatDatabase, userId: string) => {
  const user = await db.query.users.findFirst({ columns: { banned: true }, where: eq(users.id, userId) });
  if (!user || user.banned) failure('FORBIDDEN', 'Inactive user');
};

const roleFor = async (db: LobeChatDatabase, userId: string, workspaceId?: string | null, edit = false) => {
  if (!workspaceId) {
    if (edit) failure('BAD_REQUEST', 'Workspace is required');
    return;
  }
  const role = await getActiveWorkspaceRole(db, workspaceId, userId);
  if (!role || (edit && role !== 'admin' && role !== 'owner')) failure('FORBIDDEN', 'Insufficient workspace access');
};

const personalOwner = (userId: string, workspaceId?: string | null) => `${userId}\0${workspaceId ?? ''}`;
const readCollections = async (db: LobeChatDatabase, family: 'personal' | 'shared', owner: string, userId: string, workspaceId?: string | null) => {
  const rows = await new EngineeringToolsWorkspaceModel(db).list(family, owner);
  return rows.flatMap((row) => {
    const parsed = engineeringCollectionSchema.safeParse(row.value);
    if (!parsed.success || parsed.data.workspaceId !== (workspaceId ?? null)) return [];
    if (family === 'personal' && parsed.data.ownerId !== userId) return [];
    return [parsed.data];
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
};

const saveCollection = async (
  db: LobeChatDatabase,
  family: 'personal' | 'shared',
  owner: string,
  userId: string,
  workspaceId: string | null | undefined,
  input: CollectionWrite,
) => {
  return db.transaction(async (tx) => {
    if (workspaceId) await roleFor(tx as LobeChatDatabase, userId, workspaceId, family === 'shared');
    const model = new EngineeringToolsWorkspaceModel(tx);
    const id = input.id ?? randomUUID();
    const current = input.id && await model.get(family, owner, id);
    if (input.id && !input.expectedVersion) failure('BAD_REQUEST', 'expectedVersion is required');
    if (input.id && !current) failure('NOT_FOUND', 'Collection not found');
    const prior = current && engineeringCollectionSchema.safeParse(current.value);
    if (current && (!prior || !prior.success || prior.data.workspaceId !== (workspaceId ?? null) ||
      (family === 'personal' && prior.data.ownerId !== userId))) failure('FORBIDDEN', 'Collection scope mismatch');
    const version = prior && prior.success ? prior.data.version + 1 : 1;
    const value: EngineeringCollection = {
      entries: input.entries,
      groups: input.groups,
      id,
      name: input.name,
      ownerId: prior && prior.success ? prior.data.ownerId : userId,
      sortOrder: input.sortOrder,
      version,
      workspaceId: workspaceId ?? null,
    };
    const parsed = engineeringCollectionSchema.parse(value);
    const saved = current
      ? await model.replace(family, owner, id, input.expectedVersion!, parsed)
      : await model.create(family, owner, id, parsed);
    if (!saved) failure('CONFLICT', 'Collection changed concurrently');
    if (family === 'shared' && workspaceId) {
      await new WorkspaceAuditLogModel(tx as LobeChatDatabase).create({
        action: current ? 'resource.updated' : 'resource.created',
        resourceId: id,
        resourceType: 'engineeringToolCollection',
        userId,
        workspaceId,
      });
    }
    return { id, version };
  });
};

const removeCollection = async (
  db: LobeChatDatabase,
  family: 'personal' | 'shared',
  owner: string,
  userId: string,
  workspaceId: string | null | undefined,
  input: CollectionDelete,
) => db.transaction(async (tx) => {
  if (workspaceId) await roleFor(tx as LobeChatDatabase, userId, workspaceId, family === 'shared');
  const model = new EngineeringToolsWorkspaceModel(tx);
  const current = await model.get(family, owner, input.id);
  if (!current) failure('NOT_FOUND', 'Collection not found');
  const parsed = engineeringCollectionSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.workspaceId !== (workspaceId ?? null) ||
    (family === 'personal' && parsed.data.ownerId !== userId)) failure('FORBIDDEN', 'Collection scope mismatch');
  if (!await model.remove(family, owner, input.id, input.expectedVersion)) failure('CONFLICT', 'Collection changed concurrently');
  if (family === 'shared' && workspaceId) {
    await new WorkspaceAuditLogModel(tx as LobeChatDatabase).create({
      action: 'resource.deleted', resourceId: input.id, resourceType: 'engineeringToolCollection', userId, workspaceId,
    });
  }
  return { removed: true };
});

const readTool = async (db: LobeChatDatabase, toolId: string, requireEnabled = true) => {
  const row = await new EngineeringToolsModel(db).get(toolId);
  const parsed = engineeringToolSchema.safeParse(row?.value);
  if (!parsed.success || (requireEnabled && !parsed.data.enabled)) failure('NOT_FOUND', 'Tool unavailable');
  return parsed.data;
};

export const engineeringWorkspaceProcedures = {
  listPanelState: userProcedure.query(async ({ ctx }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const row = await new EngineeringToolsWorkspaceModel(ctx.serverDB).get('panel', personalOwner(ctx.userId, ctx.workspaceId), 'current');
    if (!row) return { activeTabId: null, panelOpen: false, tabs: [], version: 0, width: null };
    const parsed = panelStateSchema.safeParse(row.value);
    if (!parsed.success) failure('CONFLICT', 'Invalid panel state');
    return parsed.data;
  }),
  savePanelState: userProcedure.input(panelStateWriteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return ctx.serverDB.transaction(async (tx) => {
      await activeUser(tx as LobeChatDatabase, ctx.userId);
      if (ctx.workspaceId) await roleFor(tx as LobeChatDatabase, ctx.userId, ctx.workspaceId);
      const model = new EngineeringToolsWorkspaceModel(tx);
      const owner = personalOwner(ctx.userId, ctx.workspaceId);
      const current = await model.get('panel', owner, 'current');
      const prior = current && panelStateSchema.safeParse(current.value);
      if (current && (!prior || !prior.success)) failure('CONFLICT', 'Invalid panel state');
      const version = prior && prior.success ? prior.data.version + 1 : 1;
      const value = panelStateSchema.parse({ activeTabId: input.activeTabId, panelOpen: input.panelOpen,
        tabs: input.tabs, version, width: input.width });
      const saved = current
        ? await model.replace('panel', owner, 'current', input.expectedVersion, value)
        : input.expectedVersion === 0 && await model.create('panel', owner, 'current', value);
      if (!saved) failure('CONFLICT', 'Panel changed concurrently');
      return { version };
    });
  }),
  listPersonalCollections: userProcedure.query(async ({ ctx }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return readCollections(ctx.serverDB, 'personal', personalOwner(ctx.userId, ctx.workspaceId), ctx.userId, ctx.workspaceId);
  }),
  savePersonalCollection: userProcedure.input(collectionWriteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return saveCollection(ctx.serverDB, 'personal', personalOwner(ctx.userId, ctx.workspaceId), ctx.userId, ctx.workspaceId, input);
  }),
  removePersonalCollection: userProcedure.input(collectionDeleteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return removeCollection(ctx.serverDB, 'personal', personalOwner(ctx.userId, ctx.workspaceId), ctx.userId, ctx.workspaceId, input);
  }),
  listWorkspaceCollections: userProcedure.query(async ({ ctx }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    if (!ctx.workspaceId) failure('BAD_REQUEST', 'Workspace is required');
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return readCollections(ctx.serverDB, 'shared', ctx.workspaceId, ctx.userId, ctx.workspaceId);
  }),
  saveWorkspaceCollection: userProcedure.input(collectionWriteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    if (!ctx.workspaceId) failure('BAD_REQUEST', 'Workspace is required');
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId, true);
    return saveCollection(ctx.serverDB, 'shared', ctx.workspaceId, ctx.userId, ctx.workspaceId, input);
  }),
  removeWorkspaceCollection: userProcedure.input(collectionDeleteSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    if (!ctx.workspaceId) failure('BAD_REQUEST', 'Workspace is required');
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId, true);
    return removeCollection(ctx.serverDB, 'shared', ctx.workspaceId, ctx.userId, ctx.workspaceId, input);
  }),
  adminListEndpoints: adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppRead).query(async ({ ctx }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    const rows = await new EngineeringToolsWorkspaceModel(ctx.serverDB).list('endpoint', endpointOwner);
    return rows.flatMap((row) => {
      const parsed = engineeringEndpointSchema.safeParse(row.value);
      return parsed.success ? [parsed.data] : [];
    });
  }),
  listEndpointsForTool: userProcedure.input(resolveLaunchSchema.pick({ toolId: true })).query(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const tool = await readTool(ctx.serverDB, input.toolId);
    if (tool.shape !== 'web' && tool.shape !== 'hybrid') return [];
    const rows = await new EngineeringToolsWorkspaceModel(ctx.serverDB).list('endpoint', endpointOwner);
    const summaries: ToolEndpointSummary[] = rows.flatMap((row) => {
      const parsed = engineeringEndpointSchema.safeParse(row.value);
      if (!parsed.success || parsed.data.toolId !== input.toolId) return [];
      const { authPrerequisite, id, licenseState, mode, title } = parsed.data;
      const reason = endpointUnavailableReason(parsed.data);
      return [{ authPrerequisite, available: reason === null, id, licenseState, mode, reason,
        revision: configuredEndpointRevision(parsed.data), title }];
    });
    if (summaries.length === 0 && tool.accessState === 'launch_verified' && tool.launchUrl) {
      summaries.push({ authPrerequisite: '', available: true, id: null, licenseState: 'verified', mode: 'external_web', reason: null,
        revision: legacyEndpointRevision(tool), title: tool.name });
    }
    return summaries.sort((a, b) => a.title.localeCompare(b.title));
  }),
  adminSaveEndpoint: adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppWrite)
    .input(endpointWriteSchema).mutation(async ({ ctx, input }) => {
      await activeUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation<{ id: string; version: number }>(ctx, {
        audit: (result) => ({ action: 'engineeringTool.endpointSaved', resourceId: result.id, resourceType: 'engineeringToolEndpoint' }),
        mutation: async (tx) => {
          await readTool(tx as LobeChatDatabase, input.toolId, false);
          const model = new EngineeringToolsWorkspaceModel(tx);
          const id = input.id ?? randomUUID();
          if (input.id && !input.expectedVersion) failure('BAD_REQUEST', 'expectedVersion is required');
          const current = input.id && await model.get('endpoint', endpointOwner, id);
          if (input.id && !current) failure('NOT_FOUND', 'Endpoint not found');
          const prior = current && engineeringEndpointSchema.safeParse(current.value);
          if (current && (!prior || !prior.success)) failure('CONFLICT', 'Invalid existing endpoint');
          const version = prior && prior.success ? prior.data.version + 1 : 1;
          const value = engineeringEndpointSchema.parse({ ...input, id, version });
          const saved = current
            ? await model.replace('endpoint', endpointOwner, id, input.expectedVersion!, value)
            : await model.create('endpoint', endpointOwner, id, value);
          if (!saved) failure('CONFLICT', 'Endpoint changed concurrently');
          return { id, version };
        },
      });
    }),
  adminDisableEndpoint: adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppWrite)
    .input(endpointDisableSchema).mutation(async ({ ctx, input }) => {
      await activeUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation(ctx, {
        audit: () => ({ action: 'engineeringTool.endpointDisabled', resourceId: input.id, resourceType: 'engineeringToolEndpoint' }),
        mutation: async (tx) => {
          const model = new EngineeringToolsWorkspaceModel(tx);
          const row = await model.get('endpoint', endpointOwner, input.id);
          if (!row) failure('NOT_FOUND', 'Endpoint not found');
          const parsed = engineeringEndpointSchema.safeParse(row.value);
          if (!parsed.success) failure('CONFLICT', 'Invalid existing endpoint');
          const version = parsed.data.version + 1;
          if (!await model.replace('endpoint', endpointOwner, input.id, input.expectedVersion, { ...parsed.data, enabled: false, version }))
            failure('CONFLICT', 'Endpoint changed concurrently');
          return { id: input.id, version };
        },
      });
    }),
  // L2-2 (docs/pilot/l2-audit-log-design.md; ui-ux-spec §5.2/A5-3): minimal
  // tool-open behavior audit. Reuses the existing admin_audit_logs table via
  // recordAdminAudit — no new table, no migration, no schema change (G4 not
  // triggered). Mode 'best-effort': audit failure must not block tool usage
  // (action is allow-listed in LOW_RISK_BEST_EFFORT_ADMIN_AUDIT_ACTIONS).
  // Records only "what was opened" (userId/action/resourceId/ts server-side);
  // iframe-internal operations are never recorded (explicit platform
  // zero-visibility assumption, ui-ux-spec §5.2).
  recordToolLaunchAudit: userProcedure.input(toolAuditSchema).mutation(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    const result = await recordAdminAudit(
      { clientIp: ctx.clientIp ?? null, serverDB: ctx.serverDB, userId: ctx.userId },
      {
        action: input.action,
        payload: { endpointId: input.endpointId, workspaceId: ctx.workspaceId ?? null },
        resourceId: input.toolId,
        resourceType: 'engineeringToolLaunch',
      },
      { mode: 'best-effort' },
    );
    return { correlationId: result.correlationId, ok: result.ok };
  }),
  resolveLaunch: userProcedure.input(resolveLaunchSchema).query(async ({ ctx, input }) => {
    await activeUser(ctx.serverDB, ctx.userId);
    await roleFor(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const tool = await readTool(ctx.serverDB, input.toolId);
    if (tool.shape !== 'web' && tool.shape !== 'hybrid') failure('FORBIDDEN', 'Tool has no verified Web runtime');
    const model = new EngineeringToolsWorkspaceModel(ctx.serverDB);
    const rows = input.endpointId
      ? [await model.get('endpoint', endpointOwner, input.endpointId)]
      : await model.list('endpoint', endpointOwner);
    const endpoints = rows.flatMap((row) => {
      const parsed = engineeringEndpointSchema.safeParse(row?.value);
      return parsed.success && parsed.data.toolId === tool.id ? [parsed.data] : [];
    });
    const endpoint: EngineeringEndpoint | undefined = input.endpointId
      ? endpoints[0]
      : endpoints.find(endpointLaunchable);
    if (input.endpointId && !endpoint) failure('NOT_FOUND', 'Endpoint not found');
    if (endpoint) {
      if (!endpointLaunchable(endpoint)) failure('FORBIDDEN', 'Endpoint permission or evidence is not verified');
      const base = { authPrerequisite: endpoint.authPrerequisite, endpointId: endpoint.id,
        revision: configuredEndpointRevision(endpoint), title: endpoint.title, toolId: tool.id, url: endpoint.url };
      return endpoint.mode === 'external_web'
        ? { ...base, mode: 'external_web' as const, rel: 'noopener noreferrer' as const, target: '_blank' as const }
        : { ...base, evidenceCheckedAt: endpoint.licenseEvidence!.checkedAt, framePolicy: 'verified' as const, mode: endpoint.mode };
    }
    if (endpoints.length > 0) failure('FORBIDDEN', 'No permitted endpoint is available');
    if (input.endpointId || tool.accessState !== 'launch_verified' || !tool.launchUrl)
      failure('FORBIDDEN', 'No verified launch endpoint');
    return { authPrerequisite: '', endpointId: null, mode: 'external_web' as const,
      revision: legacyEndpointRevision(tool),
      rel: 'noopener noreferrer' as const, target: '_blank' as const, title: tool.name, toolId: tool.id, url: tool.launchUrl };
  }),
};
