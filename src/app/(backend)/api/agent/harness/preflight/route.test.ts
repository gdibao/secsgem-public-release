import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { HeterogeneousRuntimeOwnershipError } from '@/database/models/heterogeneousRuntime';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import { validateHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import type * as OperationPrincipalModule from '@/server/services/heterogeneousAgent/operationPrincipal';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { POST } from './route';

const { assertSessionOwned, ensureTenant } = vi.hoisted(() => ({
  assertSessionOwned: vi.fn(),
  ensureTenant: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/heterogeneousRuntime', () => ({
  HeterogeneousRuntimeModel: class {
    assertSessionOwned = assertSessionOwned;
    ensureTenant = ensureTenant;
  },
  HeterogeneousRuntimeOwnershipError: class extends Error {},
}));
vi.mock('@/envs/auth', () => ({ authEnv: { AUTH_SECRET: 'test-secret-with-enough-bytes' } }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({ validateHeteroOperationJWT: vi.fn() }));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => {
  const actual = await importOriginal<typeof OperationPrincipalModule>();
  return { ...actual, resolveActiveHeteroOperationPrincipal: vi.fn() };
});

const request = (body?: Record<string, unknown>) =>
  new Request('https://fab.example/api/agent/harness/preflight', {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      authorization: 'Bearer operation-token',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    method: 'POST',
  });

const claims: HeteroOperationJwtClaims = {
  aud: 'urn:lobehub:hetero-operation',
  capabilities: ['hetero:ingest'] as const,
  exp: 123,
  iat: 1,
  iss: 'urn:lobehub:internal',
  jti: 'jti-1',
  operation_id: 'op-1',
  provider_id: 'codex',
  purpose: 'hetero-operation' as const,
  sub: 'user-private',
  workspace_id: 'workspace-private',
};

describe('server harness preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(validateHeteroOperationJWT).mockResolvedValue(claims);
    vi.mocked(resolveActiveHeteroOperationPrincipal).mockResolvedValue({
      operationId: 'op-1',
      topicId: 'topic-1',
      userId: 'user-private',
      workspaceId: 'workspace-private',
    });
    ensureTenant.mockImplementation(async (input) => ({ id: 'tenant-1', ...input }));
    assertSessionOwned.mockResolvedValue({ id: 'session-1' });
  });

  it('checks a requested official session against the authenticated tenant', async () => {
    const response = await POST(request({ resumeSessionId: 'codex-thread-1', topicId: 'topic-1' }));

    expect(response.status).toBe(200);
    expect(assertSessionOwned).toHaveBeenCalledWith(
      {
        provider: 'codex',
        userId: 'user-private',
        workspaceId: 'workspace-private',
      },
      'codex-thread-1',
    );
  });

  it('fails closed when a native session belongs to another tenant', async () => {
    assertSessionOwned.mockRejectedValueOnce(new HeterogeneousRuntimeOwnershipError());

    const response = await POST(request({ resumeSessionId: 'foreign-thread', topicId: 'topic-1' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'runtime_session_not_owned' });
  });

  it('returns only an opaque tenant partition after durable authorization', async () => {
    const response = await POST(request({ topicId: 'topic-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ expiresAt: 123, operationId: 'op-1', provider: 'codex' });
    expect(body.tenantKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain('user-private');
    expect(JSON.stringify(body)).not.toContain('workspace-private');
    expect(resolveActiveHeteroOperationPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'hetero:ingest', operationId: 'op-1' }),
    );
  });

  it('derives a distinct partition for each official provider in the same Fab scope', async () => {
    await POST(request({ topicId: 'topic-1' }));
    const codexPartition = ensureTenant.mock.calls.at(-1)?.[0].partitionKey;

    vi.mocked(validateHeteroOperationJWT).mockResolvedValueOnce({
      ...claims,
      provider_id: 'dsh',
    });
    await POST(request({ topicId: 'topic-1' }));
    const dshPartition = ensureTenant.mock.calls.at(-1)?.[0].partitionKey;

    expect(codexPartition).toMatch(/^[a-f0-9]{64}$/);
    expect(dshPartition).toMatch(/^[a-f0-9]{64}$/);
    expect(dshPartition).not.toBe(codexPartition);
  });

  it('rejects a forged topic before exposing the tenant partition', async () => {
    const response = await POST(request({ topicId: 'topic-other' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'operation_topic_mismatch' });
    expect(ensureTenant).not.toHaveBeenCalled();
  });

  it('rejects an unsupported provider before opening a worker partition', async () => {
    vi.mocked(validateHeteroOperationJWT).mockResolvedValueOnce({
      ...claims,
      provider_id: 'claude-code',
    });

    const response = await POST(request({ topicId: 'topic-1' }));
    expect(response.status).toBe(401);
    expect(resolveActiveHeteroOperationPrincipal).not.toHaveBeenCalled();
  });

  it('preserves durable operation authorization failures', async () => {
    vi.mocked(resolveActiveHeteroOperationPrincipal).mockRejectedValueOnce(
      new HeteroOperationPrincipalError('outside scope', 403),
    );

    const response = await POST(request({ topicId: 'topic-1' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'operation_not_authorized' });
  });
});
