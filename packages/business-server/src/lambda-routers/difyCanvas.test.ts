// @vitest-environment node
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { difyCanvasRouter } from './difyCanvas';

const mocks = vi.hoisted(() => {
  const roleQuery = vi.fn();
  const findAdmin = vi.fn();
  const hasPermission = vi.fn();
  const auditCreate = vi.fn();
  const rbacDb = vi.fn();
  const auditDb = vi.fn();
  const db = {
    query: { users: { findFirst: findAdmin } },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => ({
          limit: async () => {
            const sql = condition as SQL;
            if (dialect.sqlToQuery(sql).params.length !== 1) return roleQuery(sql);
            const user = await findAdmin({ where: sql });
            return user ? [user] : [];
          },
        })),
      })),
    })),
  };
  return { auditCreate, auditDb, db, findAdmin, getServerDB: vi.fn(), hasPermission, rbacDb, roleQuery };
});

vi.mock('@lobechat/database', () => ({ serverDB: mocks.db }));
vi.mock('@lobechat/database/schemas', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  return {
    users: pgTable('users', { banned: text('banned'), id: text('id'), role: text('role') }),
    workspaceMembers: pgTable('workspace_members', {
      deletedAt: timestamp('deleted_at'),
      role: text('role'),
      userId: text('user_id'),
      workspaceId: text('workspace_id'),
    }),
  };
});
vi.mock('@/database/schemas', async (importOriginal) => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    users: pgTable('users', { banned: text('banned'), id: text('id'), role: text('role') }),
    workspaceMembers: pgTable('workspace_members', {
      deletedAt: timestamp('deleted_at'),
      role: text('role'),
      userId: text('user_id'),
      workspaceId: text('workspace_id'),
    }),
  };
});
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    constructor(db: unknown) {
      mocks.rbacDb(db);
    }

    hasPermission = mocks.hasPermission;
  },
}));
vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: class {
    constructor(db: unknown) {
      mocks.auditDb(db);
    }

    create = mocks.auditCreate;
  },
}));
vi.mock('@/envs/auth', () => ({
  authEnv: { AUTH_PHONE_BINDING_EXEMPT_USER_IDS: '', AUTH_PHONE_BINDING_REQUIRED: false },
}));
vi.mock('@/libs/better-auth/phone-identity', () => ({
  findVerifiedPhoneIdentity: vi.fn(),
  hasVerifiedPhoneIdentity: vi.fn(),
  isPhoneBindingExempt: vi.fn(),
}));
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

const config = {
  healthUrl: 'http://dify-web:3000/health',
  studioOrigin: 'https://studio.example.test/',
  workspaces: [
    {
      difyWorkspaceId: 'dify-a',
      fabWorkspaceId: 'ws-a',
      workflows: [
        {
          appId: 'app-a',
          name: 'A flow',
          publishedPath: '/apps/app-a',
          studioPath: '/app/app-a/workflow',
        },
      ],
    },
    {
      difyWorkspaceId: 'dify-b',
      fabWorkspaceId: 'ws-b',
      workflows: [{ appId: 'app-b', name: 'B flow', studioPath: '/app/app-b/workflow' }],
    },
  ],
};
const serviceApiOrigin = 'http://dify-api:5001';
const serviceApiKey = 'test-service-api-key';

const dialect = new PgDialect();
const caller = (userId = 'alice', workspaceId: string | undefined = 'ws-a') =>
  difyCanvasRouter.createCaller({
    serverDB: mocks.db,
    userId,
    ...(workspaceId ? { workspaceId } : {}),
  } as never);

let memberships: Array<{ role: string; userId: string; workspaceId: string }>;
let adminRoles: Record<string, string>;

describe('difyCanvasRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DIFY_SERVICE_API_ORIGIN;
    delete process.env.DIFY_WORKFLOW_API_KEYS_JSON;
    process.env.DIFY_CANVAS_CONFIG_JSON = JSON.stringify(config);
    process.env.DIFY_SERVICE_API_ORIGIN = serviceApiOrigin;
    process.env.DIFY_WORKFLOW_API_KEYS_JSON = JSON.stringify({ 'app-a': serviceApiKey, 'app-b': 'other-key' });
    memberships = [
      { role: 'member', userId: 'alice', workspaceId: 'ws-a' },
      { role: 'member', userId: 'bob', workspaceId: 'ws-b' },
      { role: 'member', userId: 'eve', workspaceId: 'ws-b' },
      { role: 'viewer', userId: 'carol', workspaceId: 'ws-a' },
    ];
    adminRoles = {
      alice: 'system_admin',
      bob: 'user',
      carol: 'admin',
      dave: 'finance_admin',
      eve: 'user',
    };
    mocks.getServerDB.mockResolvedValue(mocks.db);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.rbacDb.mockClear();
    mocks.auditDb.mockClear();
    mocks.findAdmin.mockImplementation(async ({ where }) => {
      const [userId] = dialect.sqlToQuery(where).params;
      return { banned: false, role: adminRoles[String(userId)] };
    });
    mocks.roleQuery.mockImplementation(async (condition) => {
      const [workspaceId, userId] = dialect.sqlToQuery(condition).params;
      const membership = memberships.find(
        (row) => row.workspaceId === workspaceId && row.userId === userId,
      );
      return membership ? [{ role: membership.role }] : [];
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) => {
        const requestUrl = String(url);
        return requestUrl === config.healthUrl
          ? Promise.resolve({ ok: true })
          : requestUrl.includes('/v1/parameters')
            ? Promise.resolve({
                json: async () => ({
                  user_input_form: [
                    { 'text-input': { label: 'Prompt', required: false, variable: 'prompt' } },
                  ],
                }),
                ok: true,
                status: 200,
              })
            : Promise.resolve({
              json: async () => ({
                data: { id: 'run-a1', outputs: { answer: 'safe output' }, status: 'succeeded' },
              }),
              ok: true,
              status: 200,
            });
      }),
    );
  });

  afterEach(() => {
    delete process.env.DIFY_CANVAS_CONFIG_JSON;
    delete process.env.DIFY_SERVICE_API_ORIGIN;
    delete process.env.DIFY_WORKFLOW_API_KEYS_JSON;
    vi.unstubAllGlobals();
  });

  it('lists mapped published workflows but never returns a Dify published URL', async () => {
    await expect(caller().list()).resolves.toEqual({
      available: true,
      workflows: [{ appId: 'app-a', name: 'A flow' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(config.healthUrl, expect.any(Object));
  });

  it('does not advertise workflows to banned users or users without model invocation permission', async () => {
    mocks.findAdmin.mockResolvedValueOnce({ banned: true, role: 'user' });
    await expect(caller().list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mocks.hasPermission.mockResolvedValueOnce(false);
    await expect(caller().list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('proxies Dify parameters into a bounded standard-field schema without exposing the app key', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      if (String(url) === config.healthUrl) return { ok: true } as Response;
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${serviceApiKey}`);
      expect(String(url)).toBe(`${serviceApiOrigin}/v1/parameters?user=fab%3Aalice`);
      return {
        json: async () => ({
          user_input_form: [
            { 'text-input': { default: 'A', label: '项目名称', max_length: null, required: true, variable: 'project' } },
            { select: { label: '优先级', options: ['普通', '紧急'], required: true, variable: 'priority' } },
            { json_object: { default: { area: 'A' }, label: '参数', required: false, variable: 'payload' } },
          ],
        }),
        ok: true,
      } as Response;
    });

    const parameters = await caller().parameters({ appId: 'app-a' });
    expect(parameters).toEqual({
      appId: 'app-a',
      fields: [
        { defaultValue: 'A', label: '项目名称', required: true, type: 'text-input', variable: 'project' },
        { label: '优先级', options: ['普通', '紧急'], required: true, type: 'select', variable: 'priority' },
        { defaultValue: { area: 'A' }, label: '参数', required: false, type: 'json_object', variable: 'payload' },
      ],
    });
    expect(JSON.stringify(parameters)).not.toContain(serviceApiKey);
  });

  it('fails closed for unsupported Dify parameter fields', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
      String(url) === config.healthUrl
        ? ({ ok: true } as Response)
        : ({ json: async () => ({ user_input_form: [{ unsupported: { variable: 'x', label: 'X' } }] }), ok: true } as Response),
    );
    await expect(caller().parameters({ appId: 'app-a' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Dify workflow parameters are unavailable',
    });
  });

  it.each(['file', 'file-list', 'external_data_tool'])(
    'fails closed for unsupported %s inputs instead of advertising a complete form',
    async (type) => {
      vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
        String(url) === config.healthUrl
          ? ({ ok: true } as Response)
          : ({ json: async () => ({ user_input_form: [{ [type]: { variable: 'upload', label: 'Upload' } }] }), ok: true } as Response),
      );
      await expect(caller().parameters({ appId: 'app-a' })).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Dify workflow parameters are unavailable',
      });
    },
  );

  it('validates required parameter values against Dify fields before auditing or running', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
      String(url) === config.healthUrl
        ? ({ ok: true } as Response)
        : ({
            json: async () => ({
              user_input_form: [{ 'text-input': { label: '项目名称', required: true, variable: 'project' } }],
            }),
            ok: true,
          } as Response),
    );
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['admin', 'system_admin', 'module_admin'])(
    'allows %s capability to list and open a flow mapped to the active workspace',
    async (role) => {
      adminRoles.alice = role;
      await expect(caller().adminList()).resolves.toEqual({
        available: true,
        workflows: [{ appId: 'app-a', name: 'A flow' }],
      });
      await expect(caller().openStudio({ appId: 'app-a' })).resolves.toEqual({
        url: 'https://studio.example.test/app/app-a/workflow',
      });
    },
  );

  it('allows a module_admin with viewer membership to inspect and open Studio without run permission', async () => {
    adminRoles.alice = 'module_admin';
    memberships = [{ role: 'viewer', userId: 'alice', workspaceId: 'ws-a' }];
    mocks.hasPermission.mockResolvedValue(false);

    await expect(caller().adminList()).resolves.toEqual({
      available: true,
      workflows: [{ appId: 'app-a', name: 'A flow' }],
    });
    await expect(caller().openStudio({ appId: 'app-a' })).resolves.toEqual({
      url: 'https://studio.example.test/app/app-a/workflow',
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it('rejects banned admins from listing or opening Studio', async () => {
    mocks.findAdmin.mockImplementation(async () => ({ banned: true, role: 'module_admin' }));

    await expect(caller().adminList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().openStudio({ appId: 'app-a' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it.each(['admin', 'system_admin', 'module_admin'])(
    'returns the global Studio entry to %s in personal scope without workspace membership',
    async (role) => {
      adminRoles.alice = role;
      await expect(caller('alice', undefined).adminEntry()).resolves.toEqual({
        available: true,
        url: 'https://studio.example.test/',
      });
      expect(mocks.roleQuery).not.toHaveBeenCalled();
    },
  );

  it('rejects roles without either requested admin capability', async () => {
    await expect(caller('dave', undefined).adminEntry()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller('dave').adminList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('eve').openStudio({ appId: 'app-a' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps admin capability tenant-scoped, including for full admin', async () => {
    await expect(caller().openStudio({ appId: 'app-b' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller('carol', 'ws-b').adminList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('lets ordinary workspace members see published flow only, never Studio editing', async () => {
    await expect(caller().list()).resolves.toMatchObject({ workflows: [{ appId: 'app-a' }] });
    await expect(caller('eve', 'ws-b').list()).resolves.toEqual({ available: true, workflows: [] });
    await expect(caller('eve', 'ws-b').openStudio({ appId: 'app-b' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('runs a mapped workflow with a server-held token and canonical Fab user identity', async () => {
    const response = await caller().run({ appId: 'app-a', inputs: { prompt: 'hello' } });
    expect(response).toEqual({ auditRecorded: true, outputs: { answer: 'safe output' }, status: 'succeeded' });
    expect(mocks.hasPermission).toHaveBeenCalledWith('ai_model:invoke:all', { workspaceId: 'ws-a' });
    expect(mocks.rbacDb).toHaveBeenCalledWith(mocks.db);
    expect(mocks.auditDb).toHaveBeenCalledWith(mocks.db);
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      `${serviceApiOrigin}/v1/workflows/run`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${serviceApiKey}` }),
        method: 'POST',
        body: JSON.stringify({ inputs: { prompt: 'hello' }, response_mode: 'blocking', user: 'fab:alice' }),
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dify.workflow.run',
        metadata: {
          appId: 'app-a',
          outcome: 'completed',
          status: 'succeeded',
          workflowRunId: 'run-a1',
        },
        userId: 'alice',
        workspaceId: 'ws-a',
      }),
    );
    expect(JSON.stringify(response)).not.toContain(serviceApiKey);
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain('hello');
  });

  it('fails closed for a missing app key without contacting Dify', async () => {
    process.env.DIFY_WORKFLOW_API_KEYS_JSON = JSON.stringify({ 'app-b': 'other-key' });
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rechecks banned status and model invocation permission on every run', async () => {
    mocks.findAdmin.mockResolvedValueOnce({ banned: true, role: 'user' });
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    mocks.hasPermission.mockResolvedValueOnce(false);
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('denies revoked membership and a role downgraded without model invocation permission', async () => {
    memberships = [];
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    memberships = [{ role: 'viewer', userId: 'alice', workspaceId: 'ws-a' }];
    mocks.hasPermission.mockResolvedValue(false);
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects forged workspace/app selection and prevents cross-tenant app execution', async () => {
    await expect(caller().run({ appId: 'app-b', inputs: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('bob', 'ws-b').run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('records a bounded failure and does not expose upstream error bodies or tokens', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
      String(url) === config.healthUrl
        ? ({ ok: true } as Response)
        : String(url).includes('/v1/parameters')
          ? ({ json: async () => ({ user_input_form: [] }), ok: true } as Response)
          : ({ ok: false, status: 500, text: async () => `secret ${serviceApiKey}` } as Response),
    );
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'Dify workflow request failed',
    });
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain(serviceApiKey);
    expect(mocks.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { appId: 'app-a', outcome: 'upstream_rejected', httpStatus: 500 } }),
    );
  });

  it('does not report a Dify HTTP 200 failed workflow as completed', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
      String(url) === config.healthUrl
        ? ({ ok: true } as Response)
        : String(url).includes('/v1/parameters')
          ? ({
              json: async () => ({
                user_input_form: [
                  { 'text-input': { label: 'Prompt', required: false, variable: 'prompt' } },
                ],
              }),
              ok: true,
            } as Response)
          : ({
            json: async () => ({
              data: { id: 'run-failed', outputs: {}, status: 'failed' },
            }),
            ok: true,
            status: 200,
          } as Response),
    );
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'Dify workflow did not succeed',
    });
    expect(mocks.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: { appId: 'app-a', outcome: 'workflow_failed', status: 'failed', workflowRunId: 'run-failed' },
      }),
    );
    expect(mocks.auditCreate.mock.calls.map(([event]) => event.metadata.outcome)).not.toContain('completed');
  });

  it('does not call Dify when the request audit cannot be persisted', async () => {
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(caller().run({ appId: 'app-a', inputs: {} })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Workflow audit is unavailable',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(config.healthUrl, expect.any(Object));
  });

  it('returns a completed run if its outcome audit fails and never auto-retries the upstream run', async () => {
    mocks.auditCreate.mockResolvedValueOnce({ id: 'request-audit' });
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(caller().run({ appId: 'app-a', inputs: {} })).resolves.toEqual({
      auditRecorded: false,
      outputs: { answer: 'safe output' },
      status: 'succeeded',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      `${serviceApiOrigin}/v1/workflows/run`,
      expect.any(Object),
    );
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2);
  });

  it('rechecks active workspace membership and denies revoked members', async () => {
    memberships = [];
    await expect(caller().list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().adminList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when Dify is unhealthy or configuration is absent', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('offline'));
    await expect(caller().list()).resolves.toEqual({ available: false, workflows: [] });
    await expect(caller().adminList()).resolves.toEqual({ available: false, workflows: [] });
    delete process.env.DIFY_CANVAS_CONFIG_JSON;
    await expect(caller().openStudio({ appId: 'app-a' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    [
      'duplicate Fab workspace',
      { ...config, workspaces: [config.workspaces[0], config.workspaces[0]] },
    ],
    [
      'duplicate Dify workspace',
      {
        ...config,
        workspaces: [config.workspaces[0], { ...config.workspaces[1], difyWorkspaceId: 'dify-a' }],
      },
    ],
    [
      'duplicate Dify app across workspaces',
      {
        ...config,
        workspaces: [
          config.workspaces[0],
          {
            ...config.workspaces[1],
            workflows: [{ ...config.workspaces[1].workflows[0], appId: 'app-a' }],
          },
        ],
      },
    ],
  ])('fails closed for a %s mapping', async (_name, invalidConfig) => {
    process.env.DIFY_CANVAS_CONFIG_JSON = JSON.stringify(invalidConfig);
    await expect(caller().list()).resolves.toEqual({ available: false, workflows: [] });
    await expect(caller().openStudio({ appId: 'app-a' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a configured cross-origin Studio path', async () => {
    process.env.DIFY_CANVAS_CONFIG_JSON = JSON.stringify({
      ...config,
      workspaces: [
        {
          ...config.workspaces[0],
          workflows: [
            {
              ...config.workspaces[0].workflows[0],
              studioPath: '//evil.example.test/app',
            },
          ],
        },
      ],
    });
    await expect(caller().openStudio({ appId: 'app-a' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
