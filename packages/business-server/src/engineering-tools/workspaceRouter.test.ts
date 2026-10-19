// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { engineeringToolsRouter } from '../lambda-routers/engineeringTools';

const state = vi.hoisted(() => {
  const findUser = vi.fn(async () => ({ banned: false }));
  type MockRow = { value: unknown };
  const list = vi.fn<() => Promise<MockRow[]>>(async () => []);
  const getEndpoint = vi.fn<() => Promise<MockRow | undefined>>(async () => undefined);
  const getTool = vi.fn<() => Promise<MockRow | undefined>>(async () => undefined);
  const role = vi.fn(async () => 'viewer' as string | null);
  const db = { query: { users: { findFirst: findUser } } };
  return { adminAllowed: false, db, findUser, getEndpoint, getTool, list, role };
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
  return { users: pgTable('users', { banned: text('banned'), id: text('id') }) };
});
vi.mock('@/database/models/engineeringTools', () => ({ EngineeringToolsModel: class { get = state.getTool; } }));
vi.mock('@/database/models/engineeringToolsWorkspace', () => ({ EngineeringToolsWorkspaceModel: class { get = state.getEndpoint; list = state.list; } }));
vi.mock('@/database/models/workspaceAuditLog', () => ({ WorkspaceAuditLogModel: class {} }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => state.db) }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => ({ getActiveWorkspaceRole: state.role }));
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
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const middleware = trpc.middleware(({ next }) => next());
  return { ADMIN_CAPABILITIES: [], requireAdminCapability: () => middleware, requireAnyAdminCapability: () => middleware };
});
vi.mock('@/libs/trpc/lambda/middleware/requireSuperAdmin', async () => {
  const { TRPCError } = await import('@trpc/server');
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const middleware = trpc.middleware(({ next }) => {
    if (!state.adminAllowed) throw new TRPCError({ code: 'FORBIDDEN' });
    return next();
  });
  return { requireAdminCapability: () => middleware, requireAnyAdminCapability: () => middleware, requireSuperAdmin: middleware };
});
vi.mock('../lambda-routers/admin/audit', () => ({ recordAdminAudit: vi.fn(async () => ({ correlationId: 'c-1', ok: true, status: 'succeeded' })), runRequiredAdminAuditMutation: vi.fn() }));

describe('engineering workspace router registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findUser.mockResolvedValue({ banned: false });
    state.role.mockResolvedValue('viewer');
    state.getTool.mockResolvedValue(undefined);
    state.getEndpoint.mockResolvedValue(undefined);
    state.list.mockResolvedValue([]);
    state.adminAllowed = false;
  });

  it('keeps the catalog API and adds scoped collection, endpoint, and launch methods', () => {
    const names = Object.keys(engineeringToolsRouter._def.procedures);
    expect(names).toContain('list');
    expect(names).toContain('adminList');
    expect(names).toContain('listPersonalCollections');
    expect(names).toContain('saveWorkspaceCollection');
    expect(names).toContain('listEndpointsForTool');
    expect(names).toContain('adminSaveEndpoint');
    expect(names).toContain('resolveLaunch');
  });

  it('blocks a revoked workspace member from personal and shared reads', async () => {
    state.role.mockResolvedValue(null);
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a', workspaceId: 'ws-a' } as never);
    await expect(caller.listPersonalCollections()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.listWorkspaceCollections()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('allows a viewer to read but rejects shared edits', async () => {
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a', workspaceId: 'ws-a' } as never);
    await expect(caller.listWorkspaceCollections()).resolves.toEqual([]);
    await expect(caller.saveWorkspaceCollection({ entries: [], groups: [], name: 'Shared', sortOrder: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks a banned user before any collection query', async () => {
    state.findUser.mockResolvedValue({ banned: true });
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    await expect(caller.listPersonalCollections()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('does not launch an archived catalog item even with a saved URL', async () => {
    state.getTool.mockResolvedValue({ value: {
      accessState: 'launch_verified', availability: '', category: 'Piping', description: '', developerOnly: false,
      enabled: false, id: 'PG001', launchUrl: 'https://vendor.example.com/work', license: '', name: 'Archived',
      section: 'process', shape: 'web', sortOrder: 0, sourceUrl: 'https://vendor.example.com/', summary: '',
    } });
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    await expect(caller.resolveLaunch({ toolId: 'PG001' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('rejects ordinary access to endpoint administration', async () => {
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    await expect(caller.adminListEndpoints()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.adminDisableEndpoint({ id: '2879619d-dd64-4f9b-a922-94e742f579c9', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('shows hosted configuration as unavailable and refuses its launch URL', async () => {
    state.getTool.mockResolvedValue({ value: {
      accessState: 'launch_verified', availability: '', category: 'Piping', description: '', developerOnly: false,
      enabled: true, id: 'PG001', launchUrl: null, license: '', name: 'Synthetic',
      section: 'process', shape: 'web', sortOrder: 0, sourceUrl: 'https://vendor.example.com/', summary: '',
    } });
    const evidence = { checkedAt: '2026-10-18T08:00:00+08:00', reference: 'https://vendor.example.com/license' };
    state.list.mockResolvedValue([{ value: {
      authPrerequisite: '', embedEvidence: null, enabled: true,
      hostedEvidence: { approvedOrigin: 'https://vendor.example.com/', deploymentVerifiedAt: '2000-01-01T00:00:00Z', rights: evidence },
      id: '2879619d-dd64-4f9b-a922-94e742f579c9', licenseEvidence: evidence,
      licenseState: 'verified', mode: 'hosted_web', title: 'Synthetic hosted', toolId: 'PG001',
      url: 'https://vendor.example.com/work', version: 1,
    } }]);
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    await expect(caller.listEndpointsForTool({ toolId: 'PG001' })).resolves.toMatchObject([
      { available: false, reason: 'hosted_unverified' },
    ]);
    await expect(caller.resolveLaunch({ toolId: 'PG001' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('changes a configured revision when the same endpoint ID is edited', async () => {
    const tool = { accessState: 'launch_verified', availability: '', category: 'Piping', description: '', developerOnly: false,
      enabled: true, id: 'PG001', launchUrl: null, license: '', name: 'Synthetic', section: 'process', shape: 'web',
      sortOrder: 0, sourceUrl: 'https://vendor.example.com/', summary: '' };
    const evidence = { checkedAt: '2026-10-18T08:00:00+08:00', reference: 'https://vendor.example.com/license' };
    const endpoint = { authPrerequisite: '', embedEvidence: null, enabled: true, hostedEvidence: null,
      id: '2879619d-dd64-4f9b-a922-94e742f579c9', licenseEvidence: evidence, licenseState: 'verified',
      mode: 'external_web', title: 'Synthetic', toolId: 'PG001', url: 'https://vendor.example.com/a', version: 1 };
    state.getTool.mockResolvedValue({ value: tool });
    state.list.mockImplementation(async () => [{ value: endpoint }]);
    state.getEndpoint.mockImplementation(async () => ({ value: endpoint }));
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    const [first] = await caller.listEndpointsForTool({ toolId: 'PG001' });
    const firstLaunch = await caller.resolveLaunch({ toolId: 'PG001', endpointId: endpoint.id });
    expect(first.revision).toBe(firstLaunch.revision);
    expect(first).not.toHaveProperty('url');
    expect(first).not.toHaveProperty('licenseEvidence');
    endpoint.url = 'https://vendor.example.com/b';
    endpoint.version = 2;
    const [second] = await caller.listEndpointsForTool({ toolId: 'PG001' });
    const secondLaunch = await caller.resolveLaunch({ toolId: 'PG001', endpointId: endpoint.id });
    expect(second.revision).toBe(secondLaunch.revision);
    expect(second.revision).not.toBe(first.revision);
    expect(secondLaunch.url).toBe(endpoint.url);
  });

  it('hashes the current legacy URL and status into matching summary and launch revisions', async () => {
    const tool = { accessState: 'launch_verified', availability: '', category: 'Piping', description: '', developerOnly: false,
      enabled: true, id: 'PG001', launchUrl: 'https://vendor.example.com/a', license: '', name: 'Synthetic',
      section: 'process', shape: 'web', sortOrder: 0, sourceUrl: 'https://vendor.example.com/', summary: '' };
    state.getTool.mockImplementation(async () => ({ value: tool }));
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    const [first] = await caller.listEndpointsForTool({ toolId: 'PG001' });
    const firstLaunch = await caller.resolveLaunch({ toolId: 'PG001' });
    expect(first.revision).toBe(firstLaunch.revision);
    expect(first.revision).toMatch(/^legacy:[a-f0-9]{64}$/);
    expect(first).not.toHaveProperty('url');
    tool.launchUrl = 'https://vendor.example.com/b';
    const [second] = await caller.listEndpointsForTool({ toolId: 'PG001' });
    expect(second.revision).not.toBe(first.revision);
    expect((await caller.resolveLaunch({ toolId: 'PG001' })).revision).toBe(second.revision);
  });



  // L2-2 (docs/pilot/l2-audit-log-design.md): tool-open behavior audit writes
  // through recordAdminAudit (best-effort) and returns its result to the caller.
  it('records tool-open behavior audit as best-effort without blocking', async () => {
    const { recordAdminAudit } = await import('../lambda-routers/admin/audit');
    const caller = engineeringToolsRouter.createCaller({ userId: 'user-a' } as never);
    const result = await caller.recordToolLaunchAudit({
      action: 'tool_open.embedded', endpointId: 'endpoint-1', toolId: 'PG-028',
    });
    expect(result).toEqual({ correlationId: 'c-1', ok: true });
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a' }),
      expect.objectContaining({ action: 'tool_open.embedded', resourceId: 'PG-028', resourceType: 'engineeringToolLaunch' }),
      expect.objectContaining({ mode: 'best-effort' }),
    );
  });
});
