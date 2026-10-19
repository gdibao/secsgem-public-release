import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';

import { GET } from './route';

const mockGatewayEnv = vi.hoisted(() => ({
  AGENT_HARNESS_DISABLED_PROVIDERS: undefined as string | undefined,
  AGENT_HARNESS_GATEWAY_URL: undefined as string | undefined,
}));
const { findTenant, getMember } = vi.hoisted(() => ({
  findTenant: vi.fn(),
  getMember: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/heterogeneousRuntime', () => ({
  HeterogeneousRuntimeModel: class {
    findTenant = findTenant;
  },
}));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    getMember = getMember;
  },
}));
vi.mock('@/envs/gateway', () => ({ gatewayEnv: mockGatewayEnv }));

describe('server harness capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayEnv.AGENT_HARNESS_DISABLED_PROVIDERS = undefined;
    mockGatewayEnv.AGENT_HARNESS_GATEWAY_URL = undefined;
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    findTenant.mockImplementation(async ({ provider }) =>
      provider === 'openclaw'
        ? { runtimeRef: 'openclaw-cell', status: 'ready' }
        : { credentialRef: 'file:hermes.key', runtimeRef: 'http://hermes/', status: 'ready' },
    );
    getMember.mockResolvedValue({ id: 'member-1' });
  });

  it('does not expose capabilities without an authenticated Fab user', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    const response = await GET(new Request('https://fab.example/api/agent/harness/capabilities'));
    expect(response.status).toBe(401);
  });

  it('returns only provider availability and never the internal gateway address', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({ user: { id: 'user-1' } } as never);
    mockGatewayEnv.AGENT_HARNESS_GATEWAY_URL = 'http://harness.internal:41880';

    const response = await GET(new Request('https://fab.example/api/agent/harness/capabilities'));
    const body = await response.json();

    expect(body).toEqual({
      enabled: true,
      providers: [
        { available: true, type: 'codex' },
        { available: true, type: 'dsh' },
        { available: true, type: 'openclaw' },
        { available: true, type: 'hermes' },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('harness.internal');
  });

  it('reports disabled and uninitialized providers accurately', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({ user: { id: 'user-1' } } as never);
    mockGatewayEnv.AGENT_HARNESS_GATEWAY_URL = 'http://harness.internal:41880';
    mockGatewayEnv.AGENT_HARNESS_DISABLED_PROVIDERS = 'dsh';
    findTenant.mockImplementation(async ({ provider }) =>
      provider === 'openclaw' ? undefined : { runtimeRef: null, status: 'provisioning' },
    );

    const response = await GET(new Request('https://fab.example/api/agent/harness/capabilities'));
    const body = await response.json();

    expect(body.providers).toEqual([
      { available: true, type: 'codex' },
      { available: false, reason: 'disabled_by_admin', type: 'dsh' },
      { available: false, reason: 'tenant_not_ready', type: 'openclaw' },
      { available: false, reason: 'tenant_not_ready', type: 'hermes' },
    ]);
  });

  it('rejects a forged workspace before reading tenant readiness', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({ user: { id: 'user-1' } } as never);
    mockGatewayEnv.AGENT_HARNESS_GATEWAY_URL = 'http://harness.internal:41880';
    getMember.mockResolvedValueOnce(undefined);

    const response = await GET(
      new Request('https://fab.example/api/agent/harness/capabilities?workspaceId=foreign'),
    );

    expect(response.status).toBe(403);
    expect(findTenant).not.toHaveBeenCalled();
  });
});
