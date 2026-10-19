// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { engineeringToolsRouter } from '../lambda-routers/engineeringTools';

const state = vi.hoisted(() => {
  const rows = new Map<string, { value: unknown }>();
  const tools = new Map<string, { value: unknown }>();
  const menu = { row: undefined as { value: unknown } | undefined };
  const mcpConnectors = new Map<string, Record<string, unknown>[]>();
  const mcpTools = new Map<string, Record<string, unknown>[]>();
  const user = { banned: false, role: 'user' };
  const workspaceRoles = new Map<string, string>();
  const hooks = { beforeTransaction: undefined as (() => void) | undefined };
  const db = { query: { users: { findFirst: vi.fn(async () => ({ ...user })) } },
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const before = hooks.beforeTransaction;
      hooks.beforeTransaction = undefined;
      before?.();
      return callback(db);
    }) };
  return { db, hooks, mcpConnectors, mcpTools, menu, rows, tools, user, workspaceRoles };
});

vi.mock('@lobechat/database', () => ({ serverDB: state.db }));
vi.mock('@lobechat/database/schemas', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  return { workspaceMembers: pgTable('workspace_members', {
    deletedAt: timestamp('deleted_at'), role: text('role'), userId: text('user_id'), workspaceId: text('workspace_id'),
  }) };
});
vi.mock('@/database/schemas', async () => {
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  return { users: pgTable('users', { banned: text('banned'), id: text('id'), role: text('role') }) };
});
vi.mock('@/database/models/engineeringTools', () => ({ EngineeringToolsModel: class {
  get = async (id: string) => state.tools.get(id);
  list = async () => [...state.tools.values()];
  getMenu = async () => state.menu.row;
  getMenuForUpdate = async () => state.menu.row;
  saveMenu = async (value: unknown) => { state.menu.row = { value }; };
  insertMenuIfMissing = async (value: unknown) => {
    if (state.menu.row) return [];
    state.menu.row = { value };
    return [{ key: 'engineeringTools.menu' }];
  };
} }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: class {
  constructor(_db: unknown, private userId: string, private workspaceId?: string) {}
  queryPublic = async () => state.mcpConnectors.get(this.workspaceId ? `W:${this.workspaceId}` : `P:${this.userId}`) ?? [];
} }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: class {
  queryByConnector = async (connectorId: string) => state.mcpTools.get(connectorId) ?? [];
} }));
vi.mock('@/database/models/engineeringToolsWorkspace', () => ({ EngineeringToolsWorkspaceModel: class {
  key = (family: string, owner: string, id: string) => `${family}|${owner}|${id}`;
  get = async (family: string, owner: string, id: string) => state.rows.get(this.key(family, owner, id));
  list = async (family: string, owner: string) => [...state.rows.entries()]
    .filter(([key]) => key.startsWith(`${family}|${owner}|`)).map(([, row]) => row);
  create = async (family: string, owner: string, id: string, value: unknown) => {
    const key = this.key(family, owner, id);
    if (state.rows.has(key)) return false;
    state.rows.set(key, { value });
    return true;
  };
  replace = async (family: string, owner: string, id: string, expected: number, value: unknown) => {
    const key = this.key(family, owner, id);
    if ((state.rows.get(key)?.value as { version?: number } | undefined)?.version !== expected) return false;
    state.rows.set(key, { value });
    return true;
  };
  remove = async (family: string, owner: string, id: string, expected: number) => {
    const key = this.key(family, owner, id);
    if ((state.rows.get(key)?.value as { version?: number } | undefined)?.version !== expected) return false;
    return state.rows.delete(key);
  };
} }));
vi.mock('@/database/models/workspaceAuditLog', () => ({ WorkspaceAuditLogModel: class { create = vi.fn(async () => {}); } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => state.db) }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => ({
  getActiveWorkspaceRole: vi.fn(async (_db: unknown, workspaceId: string, userId: string) =>
    state.workspaceRoles.get(`${workspaceId}|${userId}`) ?? null),
}));
vi.mock('@/envs/auth', () => ({ authEnv: { AUTH_PHONE_BINDING_EXEMPT_USER_IDS: '', AUTH_PHONE_BINDING_REQUIRED: false } }));
vi.mock('@/libs/better-auth/phone-identity', () => ({ findVerifiedPhoneIdentity: vi.fn(), hasVerifiedPhoneIdentity: vi.fn(), isPhoneBindingExempt: vi.fn() }));
vi.mock('@/libs/trpc/middleware/openTelemetry', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { openTelemetry: trpc.middleware(({ next }) => next()) };
});
vi.mock('@/libs/trpc/lambda/middleware/apiKeyScope', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { apiKeyScopeGuard: trpc.middleware(({ next }) => next()) };
});
vi.mock('@/libs/trpc/lambda/middleware/heteroOperationAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { heteroOperationAuth: trpc.middleware(({ next }) => next()) };
});
vi.mock('@/libs/trpc/lambda/middleware/adminPermissions', async () => {
  const { ADMIN_CAPABILITIES } = await import('@lobechat/types');
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const middleware = trpc.middleware(({ next }) => next());
  return { ADMIN_CAPABILITIES, requireAdminCapability: () => middleware, requireAnyAdminCapability: () => middleware };
});
vi.mock('@/libs/trpc/lambda/middleware/requireSuperAdmin', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const middleware = trpc.middleware(({ next }) => next());
  return { requireAdminCapability: () => middleware, requireAnyAdminCapability: () => middleware, requireSuperAdmin: middleware };
});
vi.mock('../lambda-routers/admin/audit', () => ({
  runRequiredAdminAuditMutation: vi.fn(async (_ctx: unknown, options: {
    audit: (result: unknown) => unknown; mutation: (tx: unknown) => Promise<unknown>;
  }) => {
    const result = await options.mutation(state.db);
    options.audit(result);
    return result;
  }),
}));

const draft = {
  category: 'Process', description: 'Synthetic community item', license: 'Review pending',
  name: 'Community candidate', officialWebsiteUrl: 'https://example.com/tool',
  section: 'process' as const, shape: 'web' as const, summary: 'Synthetic', visibility: 'public' as const,
};
const curated = { accessState: 'launch_verified', availability: '', category: 'Process', description: '',
  developerOnly: true, enabled: false, id: 'PG001', launchUrl: 'https://example.com/work', license: '',
  forms: ['Web'], licenseType: 'proprietary', maintainerName: 'Candidate maintainer',
  name: 'Archived developer tool', pricingType: 'free', projectPhases: ['Design'], section: 'process',
  shape: 'web', sortOrder: 1, sourceUrl: 'https://example.com/', subsystems: ['Water'], summary: '',
  supportedOS: ['browser'], vendorName: 'Candidate vendor' };
const caller = (userId: string, workspaceId?: string) => engineeringToolsRouter.createCaller({ userId, workspaceId } as never);

describe('community router scoped state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows.clear();
    state.tools.clear();
    state.menu.row = undefined;
    state.mcpConnectors.clear();
    state.mcpTools.clear();
    state.workspaceRoles.clear();
    state.hooks.beforeTransaction = undefined;
    state.user.banned = false;
    state.user.role = 'user';
    state.tools.set('PG001', { value: curated });
    state.workspaceRoles.set('W1|alice', 'owner');
    state.workspaceRoles.set('W1|bob', 'viewer');
    state.workspaceRoles.set('W2|bob', 'owner');
  });

  it('discovers disabled developer tools without granting launch or exposing admin-only fields', async () => {
    const page = await caller('alice').listCatalog({});
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ developerOnly: true, enabled: false, id: 'PG001', publicReason: '原由待核' });
    expect(page.items[0]).toMatchObject({ accessState: 'launch_verified', forms: ['Web'], licenseType: 'proprietary',
      maintainerName: 'Candidate maintainer', pricingType: 'free', projectPhases: ['Design'],
      subsystems: ['Water'], supportedOS: ['browser'], vendorName: 'Candidate vendor' });
    expect(page.items[0]).not.toHaveProperty('launchUrl');
    await expect(caller('alice').resolveLaunch({ toolId: 'PG001' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('projects only scoped MCP inventory fields even when model rows contain secrets', async () => {
    const secret = 'SENTINEL_PRIVATE_CONNECTOR_VALUE';
    const connector = { id: 'mcp-w1', name: 'Workspace MCP', identifier: 'workspace-mcp',
      status: 'disconnected', isEnabled: true, mcpConnectionType: 'stdio',
      mcpServerUrl: secret, mcpStdioConfig: { command: secret, args: [secret], env: { TOKEN: secret } },
      credentials: secret, oidcConfig: { clientSecret: secret }, metadata: { secret } };
    state.mcpConnectors.set('W:W1', [connector, { ...connector, id: 'not-mcp', mcpConnectionType: null }]);
    state.mcpConnectors.set('W:W2', [{ ...connector, id: 'mcp-w2', name: secret }]);
    state.mcpConnectors.set('P:alice', [{ ...connector, id: 'mcp-personal' }]);
    state.mcpTools.set('mcp-w1', [{ id: 'tool-w1', toolName: 'search', displayName: 'Search',
      permission: 'auto', crudType: 'read', inputSchema: { secret }, outputSchema: { secret },
      renderConfig: { secret }, description: secret }]);
    const result = await caller('alice', 'W1').listConfiguredMcp();
    expect(result).toEqual([{ id: 'mcp-w1', name: 'Workspace MCP', identifier: 'workspace-mcp',
      status: 'disconnected', isEnabled: true, mcpConnectionType: 'stdio',
      tools: [{ id: 'tool-w1', name: 'search', displayName: 'Search', permission: 'auto', crudType: 'read' }] }]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect((await caller('alice').listConfiguredMcp()).map((item) => item.id)).toEqual(['mcp-personal']);
    state.workspaceRoles.delete('W1|alice');
    await expect(caller('alice', 'W1').listConfiguredMcp()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.user.banned = true;
    await expect(caller('alice').listConfiguredMcp()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps old menu reads/writes compatible while CAS detects legacy and concurrent edits', async () => {
    const actor = caller('alice');
    const current = [
      { enabled: true, key: 'catalog' as const, label: 'Catalog', path: '/engineering-tools?view=catalog', sortOrder: 0 },
      { enabled: true, key: 'favorites' as const, label: 'Favorites', path: '/engineering-tools?view=favorites', sortOrder: 1 },
      { enabled: true, key: 'local_mcp' as const, label: 'Local', path: '/engineering-tools?view=local_mcp', sortOrder: 2 },
    ];
    expect(await actor.adminMenuState()).toEqual({ items: [], version: 0 });
    expect(await actor.saveMenuCAS({ expectedVersion: 0, items: current })).toMatchObject({ version: 1 });
    expect(await actor.adminMenu()).toEqual(current);
    await expect(actor.saveMenuCAS({ expectedVersion: 0, items: current }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await actor.saveMenu({ items: current })).toEqual(current);
    expect(await actor.adminMenuState()).toEqual({ items: current, version: 2 });
    await expect(actor.saveMenuCAS({ expectedVersion: 1, items: current }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await actor.saveMenuCAS({ expectedVersion: 2, items: current })).toMatchObject({ version: 3 });
    await expect(actor.saveMenuCAS({ expectedVersion: 3, items: [current[0], current[1],
      { ...current[2], key: 'image', path: '/engineering-tools?section=process' }] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('reads an unversioned legacy menu as revision zero before migration', async () => {
    const legacy = [
      { enabled: true, key: 'image' as const, label: 'Image', path: '/engineering-tools?section=process', sortOrder: 0 },
      { enabled: true, key: 'ppt' as const, label: 'PPT', path: '/engineering-tools?section=automation', sortOrder: 1 },
      { enabled: true, key: 'community' as const, label: 'Community', path: '/engineering-tools?section=design', sortOrder: 2 },
    ];
    state.menu.row = { value: { items: legacy } };
    const actor = caller('alice');
    expect(await actor.adminMenuState()).toEqual({ items: legacy, version: 0 });
    expect(await actor.saveMenuCAS({ expectedVersion: 0, items: legacy })).toEqual({ items: legacy, version: 1 });
  });

  it('uses first-write and update CAS for user/workspace panel state and blocks revocation', async () => {
    const alice = caller('alice', 'W1');
    const tabId = '2879619d-dd64-4f9b-a922-94e742f579c9';
    const stateInput = { activeTabId: tabId, panelOpen: true,
      tabs: [{ closed: false, endpointId: null, id: tabId, kind: 'detail' as const, toolId: 'PG001' }], width: 1200 };
    expect(await alice.listPanelState()).toMatchObject({ tabs: [], version: 0 });
    expect(await alice.savePanelState({ ...stateInput, expectedVersion: 0 })).toEqual({ version: 1 });
    await expect(alice.savePanelState({ ...stateInput, expectedVersion: 0, width: 1210 }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await caller('bob', 'W1').listPanelState()).tabs).toEqual([]);
    state.workspaceRoles.delete('W1|alice');
    await expect(alice.listPanelState()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps workspace submissions private, requires review and does not enable a published launch', async () => {
    const owner = caller('alice', 'W1');
    const created = await owner.saveMyDraft({ ...draft, visibility: 'workspace' });
    expect((await owner.listMySubmissions()).map((item) => item.id)).toEqual([created.id]);
    expect(await caller('bob', 'W2').listCatalog({})).toMatchObject({ total: 1 });
    await expect(caller('bob', 'W2').getCatalogItem({ toolId: created.toolId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const submitted = await owner.submitMyDraft({ expectedVersion: created.version, id: created.id });
    await expect(caller('bob', 'W1').adminReview({ decision: 'publish', expectedVersion: submitted.version,
      id: created.id, reason: 'Reviewed', evidence: { checkedAt: new Date().toISOString(),
        reference: 'https://example.com/tool', verifiedUrls: ['https://example.com/tool'] } }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.workspaceRoles.set('W1|alice', 'owner');
    const published = await owner.adminReview({ decision: 'publish', expectedVersion: submitted.version,
      id: created.id, reason: 'Reviewed', evidence: { checkedAt: new Date().toISOString(),
        reference: 'https://example.com/tool', verifiedUrls: ['https://example.com/tool'] } });
    expect(published.status).toBe('published');
    expect((await caller('bob', 'W1').listCatalog({})).items.some((item) => item.id === created.toolId)).toBe(true);
    const publishedItem = (await caller('bob', 'W1').getCatalogItem({ toolId: created.toolId }));
    expect(publishedItem).toMatchObject({ accessState: 'community_published', forms: [],
      licenseType: 'unknown', maintainerName: 'unknown', pricingType: 'unknown', projectPhases: [],
      subsystems: [], supportedOS: [], vendorName: 'unknown' });
    expect((await caller('bob', 'W2').listCatalog({})).items.some((item) => item.id === created.toolId)).toBe(false);
    await expect(caller('bob', 'W1').resolveLaunch({ toolId: created.toolId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps one rating per user and target scope with CAS and accurate withdrawal', async () => {
    const alice = caller('alice');
    expect(await alice.upsertMyRating({ expectedVersion: 0, score: 5, toolId: 'PG001' })).toEqual({ score: 5, version: 1 });
    await expect(alice.upsertMyRating({ expectedVersion: 0, score: 4, toolId: 'PG001' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await caller('bob').upsertMyRating({ expectedVersion: 0, score: 3, toolId: 'PG001' }))
      .toEqual({ score: 3, version: 1 });
    expect(await alice.getRatingSummary({ toolId: 'PG001' })).toEqual({ average: 4, count: 2 });
    expect(await alice.removeMyRating({ expectedVersion: 1, toolId: 'PG001' }))
      .toEqual({ removed: true, version: 2 });
    expect(await alice.getRatingSummary({ toolId: 'PG001' })).toEqual({ average: 3, count: 1 });
    expect(await alice.getMyRating({ toolId: 'PG001' })).toEqual({ score: null, version: 2 });
    await expect(alice.upsertMyRating({ expectedVersion: 0, score: 5, toolId: 'PG001' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await alice.upsertMyRating({ expectedVersion: 2, score: 4, toolId: 'PG001' }))
      .toEqual({ score: 4, version: 3 });
    expect(await alice.getRatingSummary({ toolId: 'PG001' })).toEqual({ average: 3.5, count: 2 });
  });

  it('requires module moderation for public publication and makes author edits a reviewed revision', async () => {
    const alice = caller('alice', 'W1');
    const created = await alice.saveMyDraft(draft);
    await expect(alice.getRatingSummary({ toolId: created.toolId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const submitted = await alice.submitMyDraft({ expectedVersion: created.version, id: created.id });
    const evidence = { checkedAt: new Date().toISOString(), reference: 'https://example.com/tool',
      verifiedUrls: ['https://example.com/tool'] };
    await expect(alice.adminReview({ decision: 'publish', evidence, expectedVersion: submitted.version,
      id: created.id, reason: 'Checked' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.user.role = 'module_admin';
    const published = await alice.adminReview({ decision: 'publish', evidence, expectedVersion: submitted.version,
      id: created.id, reason: 'Checked' });
    expect((await alice.listCatalog({})).items.filter((item) => item.id === created.toolId)).toHaveLength(1);
    state.user.role = 'user';
    await expect(alice.saveMyDraft({ ...draft, expectedVersion: published.version, id: created.id, name: 'Overwritten' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const revision = await alice.startRevision({ expectedVersion: published.version, id: created.id });
    await expect(alice.startRevision({ expectedVersion: published.version, id: created.id }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const edited = await alice.saveMyDraft({ ...draft, expectedVersion: revision.version, id: revision.id,
      name: 'Revised community candidate' });
    expect((await alice.getCatalogItem({ toolId: created.toolId })).name).toBe('Community candidate');
    const revisionSubmitted = await alice.submitMyDraft({ expectedVersion: edited.version, id: revision.id });
    state.user.role = 'module_admin';
    await alice.adminReview({ decision: 'publish', evidence, expectedVersion: revisionSubmitted.version,
      id: revision.id, reason: 'Revision checked' });
    const item = await alice.getCatalogItem({ toolId: created.toolId });
    expect(item.name).toBe('Revised community candidate');
    expect((await alice.listCatalog({})).items.filter((entry) => entry.id === created.toolId)).toHaveLength(1);
    const history = await alice.listMySubmissions();
    expect(history.find((entry) => entry.id === created.id)?.status).toBe('superseded');
    expect(await alice.getRatingSummary({ toolId: created.toolId })).toEqual({ average: null, count: 0 });
    expect(await alice.upsertMyRating({ expectedVersion: 0, score: 4, toolId: created.toolId }))
      .toEqual({ score: 4, version: 1 });
  });

  it('rechecks W1 membership inside the draft-submit transaction after an interleaved revocation', async () => {
    const owner = caller('alice', 'W1');
    const created = await owner.saveMyDraft({ ...draft, visibility: 'workspace' });
    state.hooks.beforeTransaction = () => state.workspaceRoles.delete('W1|alice');
    await expect(owner.submitMyDraft({ expectedVersion: created.version, id: created.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.workspaceRoles.set('W1|alice', 'owner');
    expect((await owner.listMySubmissions())[0].status).toBe('draft');
  });

  it('does not reveal private ratings or submissions across workspaces or after a ban', async () => {
    const owner = caller('alice', 'W1');
    const created = await owner.saveMyDraft({ ...draft, visibility: 'workspace' });
    const submitted = await owner.submitMyDraft({ expectedVersion: created.version, id: created.id });
    await owner.adminReview({ decision: 'publish', expectedVersion: submitted.version, id: created.id,
      reason: 'Reviewed', evidence: { checkedAt: new Date().toISOString(),
        reference: 'https://example.com/tool', verifiedUrls: ['https://example.com/tool'] } });
    await owner.upsertMyRating({ expectedVersion: 0, score: 5, toolId: created.toolId });
    expect(await caller('bob', 'W1').getRatingSummary({ toolId: created.toolId }))
      .toEqual({ average: 5, count: 1 });
    await expect(caller('bob', 'W2').getRatingSummary({ toolId: created.toolId }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    state.user.banned = true;
    await expect(owner.getRatingSummary({ toolId: created.toolId }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
