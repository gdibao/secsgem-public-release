import { isDeepStrictEqual } from 'node:util';

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getActiveWorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { EngineeringToolsModel } from '@/database/models/engineeringTools';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

import { engineeringCommunityProcedures, publishedSubmissions } from '../engineering-tools/communityRouter';
import { facetImportSchema, missingFacetFields, revertImportedFields, vocabularyFromImport } from '../engineering-tools/facetImport';
import {
  type EngineeringFacetVocabulary,
  engineeringFacetVocabularySchema,
  engineeringMenuItemsSchema,
  engineeringMenuSchema,
  engineeringToolSchema,
  toolIdSchema,
} from '../engineering-tools/schema';
import { engineeringWorkspaceProcedures } from '../engineering-tools/workspaceRouter';
import { runRequiredAdminAuditMutation } from './admin/audit';

const readProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppRead);
const writeProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppWrite);

const assertActiveUser = async (db: LobeChatDatabase, userId: string) => {
  const user = await db.query.users.findFirst({
    columns: { banned: true, id: true },
    where: eq(users.id, userId),
  });
  if (!user || user.banned) throw new TRPCError({ code: 'FORBIDDEN' });
};

const parseTools = (rows: { value: unknown }[]) =>
  rows.flatMap((row) => {
    const parsed = engineeringToolSchema.safeParse(row.value);
    return parsed.success ? [parsed.data] : [];
  });

const catalogQuerySchema = z.object({
  cursor: toolIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  query: z.string().trim().max(120).optional(),
  section: z.enum(['process', 'automation', 'design']).optional(),
}).default({ limit: 50 });

const catalogProjection = (tool: z.infer<typeof engineeringToolSchema>) => ({
  accessState: tool.accessState ?? 'unknown',
  availability: tool.availability,
  category: tool.category,
  description: tool.description,
  developerOnly: tool.developerOnly,
  downloadUrl: undefined,
  enabled: tool.enabled,
  forms: tool.forms ?? [],
  id: tool.id,
  license: tool.license,
  licenseType: tool.licenseType ?? 'unknown',
  maintainerName: tool.maintainerName ?? 'unknown',
  name: tool.name,
  officialWebsiteUrl: tool.officialWebsiteUrl,
  pricingType: tool.pricingType ?? 'unknown',
  productUrl: tool.productUrl,
  projectPhases: tool.projectPhases ?? [],
  publicReason: tool.publicReason ?? (tool.enabled ? undefined : '原由待核'),
  purchaseUrl: tool.purchaseUrl,
  section: tool.section,
  shape: tool.shape,
  sortOrder: tool.sortOrder,
  sourceUrl: tool.sourceUrl,
  subsystems: tool.subsystems ?? [],
  summary: tool.summary,
  supportedOS: tool.supportedOS ?? [],
  vendorName: tool.vendorName ?? 'unknown',
});

const submittedCatalogProjection = (item: Awaited<ReturnType<typeof publishedSubmissions>>[number]) => ({
  accessState: 'community_published',
  availability: '社区投稿已审核；运行或安装环境未验证',
  category: item.category,
  description: item.description,
  developerOnly: item.shape === 'sdk',
  downloadUrl: item.downloadUrl,
  enabled: false,
  forms: [],
  id: item.toolId,
  license: item.license,
  licenseType: 'unknown',
  maintainerName: 'unknown',
  name: item.name,
  officialWebsiteUrl: item.officialWebsiteUrl,
  pricingType: item.pricingType ?? 'unknown',
  productUrl: item.productUrl,
  projectPhases: [],
  publicReason: '运行入口待单独核验',
  purchaseUrl: item.purchaseUrl,
  section: item.section,
  shape: item.shape,
  sortOrder: 100_000,
  sourceUrl: item.officialWebsiteUrl ?? item.productUrl ?? item.reviewEvidence!.reference,
  subsystems: [],
  summary: item.summary,
  supportedOS: [],
  vendorName: item.vendorName ?? 'unknown',
});

const emptyVocabulary: EngineeringFacetVocabulary = {
  accessStates: [], aliases: {}, forms: [], inactive: {}, labels: {}, licenseTypes: [],
  maintainerNames: [], operatingSystems: [], pricingTypes: [], projectPhases: [],
  subsystems: [], vendorNames: [],
};

const facetBatchSchema = z.object({
  patches: z.array(z.object({ fields: z.record(z.string(), z.unknown()), id: toolIdSchema })),
  state: z.enum(['imported', 'rolledBack']),
  vocabularyInserted: z.boolean(),
  vocabularyValue: engineeringFacetVocabularySchema,
});

const readVocabulary = async (db: LobeChatDatabase): Promise<EngineeringFacetVocabulary> => {
  const row = await new EngineeringToolsModel(db).getFacetVocabulary();
  const parsed = engineeringFacetVocabularySchema.safeParse(row?.value);
  return parsed.success ? parsed.data : emptyVocabulary;
};

export const engineeringToolsRouter = router({
  ...engineeringWorkspaceProcedures,
  ...engineeringCommunityProcedures,
  listConfiguredMcp: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    if (ctx.workspaceId && !await getActiveWorkspaceRole(ctx.serverDB, ctx.workspaceId, ctx.userId))
      throw new TRPCError({ code: 'FORBIDDEN' });
    const connectors = await new ConnectorModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined)
      .queryPublic();
    const toolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return Promise.all(connectors.filter((connector) => connector.mcpConnectionType).map(async (connector) => ({
      id: connector.id,
      name: connector.name,
      identifier: connector.identifier,
      status: connector.status,
      isEnabled: connector.isEnabled,
      mcpConnectionType: connector.mcpConnectionType,
      tools: (await toolModel.queryByConnector(connector.id)).map((tool) => ({
        id: tool.id,
        name: tool.toolName,
        displayName: tool.displayName,
        permission: tool.permission,
        crudType: tool.crudType,
      })),
    })));
  }),
  listCatalog: authedProcedure.use(serverDatabase).input(catalogQuerySchema).query(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    if (ctx.workspaceId && !await getActiveWorkspaceRole(ctx.serverDB, ctx.workspaceId, ctx.userId))
      throw new TRPCError({ code: 'FORBIDDEN' });
    const query = input.query?.toLocaleLowerCase();
    const curated = parseTools(await new EngineeringToolsModel(ctx.serverDB).list()).map(catalogProjection);
    const submitted = (await publishedSubmissions(ctx.serverDB, ctx.workspaceId)).map(submittedCatalogProjection);
    const items = [...curated, ...submitted]
      .filter((tool) => !input.section || tool.section === input.section)
      .filter((tool) => !query || [tool.id, tool.name, tool.summary, tool.category, tool.vendorName ?? '']
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const cursorIndex = input.cursor ? items.findIndex((tool) => tool.id === input.cursor) : -1;
    if (input.cursor && cursorIndex < 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor' });
    const start = cursorIndex + 1;
    const page = items.slice(start, start + input.limit);
    return { items: page, nextCursor: start + input.limit < items.length ? page.at(-1)?.id : undefined,
      total: items.length };
  }),
  getCatalogItem: authedProcedure.use(serverDatabase).input(z.object({ toolId: toolIdSchema })).query(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    if (ctx.workspaceId && !await getActiveWorkspaceRole(ctx.serverDB, ctx.workspaceId, ctx.userId))
      throw new TRPCError({ code: 'FORBIDDEN' });
    const row = await new EngineeringToolsModel(ctx.serverDB).get(input.toolId);
    const parsed = engineeringToolSchema.safeParse(row?.value);
    if (parsed.success) return catalogProjection(parsed.data);
    const item = (await publishedSubmissions(ctx.serverDB, ctx.workspaceId)).find((entry) => entry.toolId === input.toolId);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
    return submittedCatalogProjection(item);
  }),
  adminList: readProcedure.query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return parseTools(await new EngineeringToolsModel(ctx.serverDB).list()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
  }),

  list: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return parseTools(await new EngineeringToolsModel(ctx.serverDB).list())
      .filter((tool) => tool.enabled)
      .map(({ importBatchId: _importBatchId, ...tool }) => tool)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }),

  vocabulary: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return readVocabulary(ctx.serverDB);
  }),

  adminVocabulary: readProcedure.query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return readVocabulary(ctx.serverDB);
  }),

  saveVocabulary: writeProcedure.input(engineeringFacetVocabularySchema).mutation(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return runRequiredAdminAuditMutation<EngineeringFacetVocabulary>(ctx, {
      audit: () => ({ action: 'engineeringTool.vocabularySaved', resourceType: 'engineeringToolVocabulary' }),
      mutation: async (tx) => {
        await new EngineeringToolsModel(tx).saveFacetVocabulary(input);
        return input;
      },
    });
  }),

  importFacets: writeProcedure.input(facetImportSchema).mutation(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    if (new Set(input.entries.map((entry) => entry.id)).size !== input.entries.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate tool ID' });
    }
    return runRequiredAdminAuditMutation<{ updated: number; vocabularyInserted: boolean }>(ctx, {
      audit: (result) => ({ action: 'engineeringTool.facetsImported', payload: {
        batchId: input.batchId, updated: result.updated,
      }, resourceType: 'engineeringTool' }),
      mutation: async (tx) => {
        const model = new EngineeringToolsModel(tx);
        const inserted = await model.insertFacetBatchIfMissing(input.batchId, { importedAt: new Date().toISOString() });
        if (inserted.length === 0) return { updated: 0, vocabularyInserted: false };
        const patches: { fields: Record<string, unknown>; id: string }[] = [];
        for (const entry of input.entries) {
          const row = await model.getForUpdate(entry.id);
          if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Tool ID not found: ${entry.id}` });
          if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid tool record: ${entry.id}` });
          }
          const missing = missingFacetFields(row.value as Record<string, unknown>, entry);
          if (Object.keys(missing).length === 0) continue;
          const merged = { ...row.value, ...missing };
          if (!engineeringToolSchema.safeParse(merged).success) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid merged tool: ${entry.id}` });
          }
          await model.save(entry.id, merged);
          patches.push({ fields: missing, id: entry.id });
        }
        const vocabularyValue = vocabularyFromImport(input);
        const vocabularyInserted = (await model.insertFacetVocabularyIfMissing(vocabularyValue)).length === 1;
        await model.saveFacetBatch(input.batchId, { patches, state: 'imported', vocabularyInserted, vocabularyValue });
        return { updated: patches.length, vocabularyInserted };
      },
    });
  }),

  rollbackFacets: writeProcedure.input(z.object({ batchId: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await assertActiveUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation<{ fieldsRemoved: number; vocabularyRemoved: boolean }>(ctx, {
        audit: (result) => ({ action: 'engineeringTool.facetsRolledBack', payload: {
          batchId: input.batchId, fieldsRemoved: result.fieldsRemoved,
        }, resourceType: 'engineeringTool' }),
        mutation: async (tx) => {
          const model = new EngineeringToolsModel(tx);
          const row = await model.getFacetBatchForUpdate(input.batchId);
          const batch = facetBatchSchema.safeParse(row?.value);
          if (!batch.success) throw new TRPCError({ code: 'NOT_FOUND' });
          if (batch.data.state === 'rolledBack') return { fieldsRemoved: 0, vocabularyRemoved: false };
          let fieldsRemoved = 0;
          for (const patch of batch.data.patches) {
            const tool = await model.getForUpdate(patch.id);
            if (!tool?.value || typeof tool.value !== 'object' || Array.isArray(tool.value)) continue;
            const reverted = revertImportedFields(tool.value as Record<string, unknown>, patch.fields);
            fieldsRemoved += reverted.removed;
            if (reverted.removed > 0) await model.save(patch.id, reverted.value);
          }
          const currentVocabulary = await model.getFacetVocabularyForUpdate();
          const vocabularyRemoved = batch.data.vocabularyInserted &&
            isDeepStrictEqual(currentVocabulary?.value, batch.data.vocabularyValue)
            ? (await model.removeFacetVocabulary()).length === 1 : false;
          await model.saveFacetBatch(input.batchId, { ...batch.data, state: 'rolledBack' });
          return { fieldsRemoved, vocabularyRemoved };
        },
      });
    }),

  menu: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    const row = await new EngineeringToolsModel(ctx.serverDB).getMenu();
    const parsed = engineeringMenuSchema.safeParse(row?.value);
    return parsed.success ? parsed.data.items : null;
  }),

  adminMenu: readProcedure.query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    const row = await new EngineeringToolsModel(ctx.serverDB).getMenu();
    const parsed = engineeringMenuSchema.safeParse(row?.value);
    return parsed.success ? parsed.data.items : null;
  }),

  adminMenuState: readProcedure.query(async ({ ctx }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    const row = await new EngineeringToolsModel(ctx.serverDB).getMenu();
    if (!row) return { items: [], version: 0 };
    const parsed = engineeringMenuSchema.safeParse(row?.value);
    if (!parsed.success) throw new TRPCError({ code: 'CONFLICT', message: 'Invalid existing menu' });
    return { items: parsed.data.items, version: parsed.data.version ?? 0 };
  }),

  save: writeProcedure
    .input(engineeringToolSchema.omit({ importBatchId: true }))
    .mutation(async ({ ctx, input }) => {
      await assertActiveUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation(ctx, {
        audit: () => ({ action: 'engineeringTool.saved', resourceId: input.id, resourceType: 'engineeringTool' }),
        mutation: async (tx) => {
          await new EngineeringToolsModel(tx).save(input.id, input);
          return input;
        },
      });
    }),

  remove: writeProcedure.input(z.object({ id: toolIdSchema })).mutation(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return runRequiredAdminAuditMutation(ctx, {
      audit: () => ({ action: 'engineeringTool.removed', resourceId: input.id, resourceType: 'engineeringTool' }),
      mutation: async (tx) => {
        const deleted = await new EngineeringToolsModel(tx).remove(input.id);
        if (deleted.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { removed: true };
      },
    });
  }),

  saveMenu: writeProcedure
    .input(engineeringMenuSchema.omit({ importBatchId: true }))
    .mutation(async ({ ctx, input }) => {
      await assertActiveUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation(ctx, {
        audit: () => ({ action: 'engineeringTool.menuSaved', resourceType: 'engineeringToolMenu' }),
        mutation: async (tx) => {
          const model = new EngineeringToolsModel(tx);
          const current = await model.getMenuForUpdate();
          const parsed = engineeringMenuSchema.safeParse(current?.value);
          if (current && !parsed.success) throw new TRPCError({ code: 'CONFLICT', message: 'Invalid existing menu' });
          const next = { items: input.items, version: parsed.success ? (parsed.data.version ?? 0) + 1 : 1 };
          if (current) await model.saveMenu(next);
          else if ((await model.insertMenuIfMissing(next)).length !== 1)
            throw new TRPCError({ code: 'CONFLICT', message: 'Menu changed concurrently' });
          return input.items;
        },
      });
    }),

  saveMenuCAS: writeProcedure.input(z.object({
    expectedVersion: z.number().int().min(0),
    items: engineeringMenuItemsSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertActiveUser(ctx.serverDB, ctx.userId);
    return runRequiredAdminAuditMutation(ctx, {
      audit: () => ({ action: 'engineeringTool.menuSaved', resourceType: 'engineeringToolMenu' }),
      mutation: async (tx) => {
        const model = new EngineeringToolsModel(tx);
        const current = await model.getMenuForUpdate();
        const parsed = engineeringMenuSchema.safeParse(current?.value);
        if (current && !parsed.success) throw new TRPCError({ code: 'CONFLICT', message: 'Invalid existing menu' });
        const version = parsed.success ? parsed.data.version ?? 0 : 0;
        if (version !== input.expectedVersion) throw new TRPCError({ code: 'CONFLICT', message: 'Menu changed' });
        const next = { items: input.items, version: version + 1 };
        if (current) await model.saveMenu(next);
        else if ((await model.insertMenuIfMissing(next)).length !== 1)
          throw new TRPCError({ code: 'CONFLICT', message: 'Menu changed concurrently' });
        return next;
      },
    });
  }),

  importMissing: writeProcedure
    .input(z.object({ batchId: z.string().min(1).max(80), menu: engineeringMenuSchema.omit({ importBatchId: true }), tools: z.array(engineeringToolSchema.omit({ importBatchId: true })).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await assertActiveUser(ctx.serverDB, ctx.userId);
      if (new Set(input.tools.map((tool) => tool.id)).size !== input.tools.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate tool ID' });
      }
      return runRequiredAdminAuditMutation<{ inserted: number; menuInserted: boolean }>(ctx, {
        audit: (result) => ({ action: 'engineeringTool.imported', payload: { batchId: input.batchId, inserted: result.inserted }, resourceType: 'engineeringTool' }),
        mutation: async (tx) => {
          const model = new EngineeringToolsModel(tx);
          let inserted = 0;
          for (const tool of input.tools) {
            inserted += (await model.insertIfMissing(tool.id, { ...tool, importBatchId: input.batchId })).length;
          }
          const menuInserted = (await model.insertMenuIfMissing({ ...input.menu, importBatchId: input.batchId })).length === 1;
          return { inserted, menuInserted };
        },
      });
    }),

  rollbackImport: writeProcedure
    .input(z.object({ batchId: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await assertActiveUser(ctx.serverDB, ctx.userId);
      return runRequiredAdminAuditMutation<{ menuRemoved: boolean; removed: number }>(ctx, {
        audit: (result) => ({ action: 'engineeringTool.importRolledBack', payload: { batchId: input.batchId, removed: result.removed }, resourceType: 'engineeringTool' }),
        mutation: async (tx) => {
          const model = new EngineeringToolsModel(tx);
          const deleted = await model.removeImported(input.batchId);
          const menuRemoved = (await model.removeImportedMenu(input.batchId)).length === 1;
          return { menuRemoved, removed: deleted.length };
        },
      });
    }),
});
