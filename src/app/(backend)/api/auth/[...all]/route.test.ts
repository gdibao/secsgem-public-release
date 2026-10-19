// @vitest-environment node
import { ADMIN_COMMANDS } from '@lobechat/types';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

type RouteHandler = (request: Request) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  get: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
  getServerDB: vi.fn(),
  getSession: vi.fn(),
  post: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
  recordAdminAudit: vi.fn(),
  recordAdminAuditStrict: vi.fn(),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: mocks.get,
    POST: mocks.post,
  })),
}));

vi.mock('@/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/business/server/lambda-routers/admin/audit', () => ({
  recordAdminAudit: mocks.recordAdminAudit,
  recordAdminAuditStrict: mocks.recordAdminAuditStrict,
}));

const createPostRequest = (
  body: string,
  contentType = 'application/json',
  path = '/api/auth/sign-in/email',
) =>
  new Request(`https://localhost${path}`, {
    body,
    headers: {
      'Content-Type': contentType,
      Cookie: 'session=admin-session',
      'X-Forwarded-For': '203.0.113.9, 10.0.0.2',
      'X-Real-IP': '198.51.100.7',
    },
    method: 'POST',
  }) as NextRequest;

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.getServerDB.mockReset();
    mocks.getSession.mockReset();
    mocks.recordAdminAudit.mockReset();
    mocks.recordAdminAuditStrict.mockReset();
    mocks.get.mockResolvedValue(Response.json({ ok: true }));
    mocks.post.mockResolvedValue(Response.json({ ok: true }));
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-user' } });
    mocks.findFirst
      .mockResolvedValueOnce({ banned: false, role: 'admin' })
      .mockResolvedValueOnce({
        email: 'target@example.com',
        fullName: 'Target User',
        id: 'target-user',
        username: 'target',
      });
    mocks.getServerDB.mockResolvedValue({ query: { users: { findFirst: mocks.findFirst } } });
    mocks.recordAdminAudit.mockResolvedValue(undefined);
    mocks.recordAdminAuditStrict.mockResolvedValue(undefined);
  });

  it('returns 400 for malformed JSON auth requests before Better Auth handles them', async () => {
    const response = await POST(
      createPostRequest('{"email":"user@example.com","password":"secret",}'),
    );

    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    });
    expect(response.status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('passes valid JSON auth requests through without consuming the original body', async () => {
    mocks.post.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()),
    );

    const response = await POST(
      createPostRequest(JSON.stringify({ email: 'user@example.com', password: 'secret' })),
    );

    await expect(response.json()).resolves.toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates non-JSON auth requests to Better Auth', async () => {
    const response = await POST(
      createPostRequest(
        'email=user%40example.com&password=secret',
        'application/x-www-form-urlencoded',
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates GET requests to Better Auth', async () => {
    const request = new Request('https://localhost/api/auth/get-session') as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(request);
  });

  it('blocks missing and null impersonation commands before Better Auth or audit', async () => {
    for (const body of [{ userId: 'target-user' }, { command: null, userId: 'target-user' }]) {
      const response = await POST(
        createPostRequest(
          JSON.stringify(body),
          'application/json',
          '/api/auth/admin/impersonate-user',
        ),
      );

      await expect(response.json()).resolves.toMatchObject({ code: 'ADMIN_COMMAND_REQUIRED' });
      expect(response.status).toBe(400);
    }

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.recordAdminAuditStrict).not.toHaveBeenCalled();
  });

  it('blocks a mismatched impersonation command before Better Auth or audit', async () => {
    const response = await POST(
      createPostRequest(
        JSON.stringify({
          command: { actionId: 'user.setRole', confirmed: true },
          userId: 'target-user',
        }),
        'application/json',
        '/api/auth/admin/impersonate-user',
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      code: 'ADMIN_COMMAND_ACTION_MISMATCH',
    });
    expect(response.status).toBe(403);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.recordAdminAuditStrict).not.toHaveBeenCalled();
  });

  it('does not allow a trailing slash to bypass impersonation command validation', async () => {
    const response = await POST(
      createPostRequest(
        JSON.stringify({ userId: 'target-user' }),
        'application/json',
        '/api/auth/admin/impersonate-user/',
      ),
    );

    await expect(response.json()).resolves.toMatchObject({ code: 'ADMIN_COMMAND_REQUIRED' });
    expect(response.status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.recordAdminAuditStrict).not.toHaveBeenCalled();
  });

  it('blocks support admins at the real Better Auth permission boundary', async () => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValueOnce({ banned: false, role: 'support_admin' });

    const response = await POST(
      createPostRequest(
        JSON.stringify({
          command: { actionId: 'user.impersonate.attempt', confirmed: true },
          userId: 'target-user',
        }),
        'application/json',
        '/api/auth/admin/impersonate-user',
      ),
    );

    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
    expect(response.status).toBe(403);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.recordAdminAuditStrict).not.toHaveBeenCalled();
  });

  it('blocks Better Auth when the required audit insert fails', async () => {
    mocks.recordAdminAuditStrict.mockRejectedValueOnce(new Error('audit insert failed'));

    await expect(
      POST(
        createPostRequest(
          JSON.stringify({
            command: { actionId: 'user.impersonate.attempt', confirmed: true },
            userId: 'target-user',
          }),
          'application/json',
          '/api/auth/admin/impersonate-user',
        ),
      ),
    ).rejects.toThrow('audit insert failed');

    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('audits the authenticated actor and target before forwarding to Better Auth unchanged', async () => {
    const betterAuthResponse = Response.json(
      { session: { impersonatedBy: 'admin-user', userId: 'target-user' } },
      { headers: { 'Set-Cookie': 'better-auth.session_token=target-session; Path=/; HttpOnly' } },
    );
    mocks.post.mockResolvedValueOnce(betterAuthResponse);
    const command = { actionId: 'user.impersonate.attempt', confirmed: true } as const;

    const response = await POST(
      createPostRequest(
        JSON.stringify({ command, userId: 'target-user' }),
        'application/json',
        '/api/auth/admin/impersonate-user',
      ),
    );

    expect(response).toBe(betterAuthResponse);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=target-session');
    expect(mocks.recordAdminAuditStrict).toHaveBeenCalledWith(
      {
        clientIp: '203.0.113.9',
        serverDB: expect.anything(),
        userId: 'admin-user',
      },
      {
        action: ADMIN_COMMANDS['user.impersonate.attempt'].auditAction,
        payload: {
          targetEmail: 'target@example.com',
          targetFullName: 'Target User',
          targetUsername: 'target',
        },
        resourceType: 'user',
        targetUserId: 'target-user',
      },
    );
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const forwardedRequest = mocks.post.mock.calls[0][0];
    await expect(forwardedRequest.clone().json()).resolves.toEqual({ userId: 'target-user' });
    expect(forwardedRequest.headers.get('cookie')).toBe('session=admin-session');
    expect(mocks.recordAdminAuditStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.post.mock.invocationCallOrder[0],
    );
  });
});
