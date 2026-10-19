import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConnectAgentConfig,
  buildPlatformAgencyConfig,
  getConnectableProvider,
  SERVER_CONNECTABLE_PROVIDERS,
} from './providers';
import { scanLocal, scanServer } from './useAgentScan';

const detectHeterogeneousAgentCommand = vi.hoisted(() => vi.fn());

vi.mock('@/services/electron/binary', () => ({
  binaryService: { detectHeterogeneousAgentCommand },
}));

describe('scanLocal', () => {
  beforeEach(() => {
    detectHeterogeneousAgentCommand.mockReset();
  });

  it('scans OpenClaw and Hermes alongside the local coding-agent CLIs', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) => ({
      available: true,
      version: `${agentType}-version`,
    }));

    const agents = await scanLocal();

    expect(agents.openclaw).toEqual({ available: true, version: 'openclaw-version' });
    expect(agents.hermes).toEqual({ available: true, version: 'hermes-version' });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'openclaw',
      command: 'openclaw',
    });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'hermes',
      command: 'hermes',
    });
  });

  it('preserves detector and IPC failure reasons', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) => {
      if (agentType === 'openclaw') {
        return { available: false, error: 'openclaw failed validation' };
      }
      if (agentType === 'hermes') throw new Error('hermes scan timed out');
      return { available: false };
    });

    const agents = await scanLocal();

    expect(agents.openclaw).toEqual({
      available: false,
      reason: 'openclaw failed validation',
      version: undefined,
    });
    expect(agents.hermes).toEqual({
      available: false,
      reason: 'hermes scan timed out',
    });
  });
});

describe('scanServer', () => {
  it('exposes only the four server-managed bases in the server inventory', () => {
    expect(SERVER_CONNECTABLE_PROVIDERS.map(({ type }) => type)).toEqual([
      'codex',
      'dsh',
      'openclaw',
      'hermes',
    ]);
  });

  it('maps only capabilities reported by the authenticated Fab server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ enabled: true, providers: ['codex', 'dsh', 'openclaw', 'hermes'] }),
      ),
    );

    const agents = await scanServer();

    expect(agents.codex).toEqual({ available: true });
    expect(agents.dsh).toEqual({ available: true });
    expect(agents.openclaw).toEqual({ available: true });
    expect(agents.hermes).toEqual({ available: true });
    expect(agents['claude-code']).toEqual({ available: false });
  });

  it('rejects an HTML SPA fallback with a stable scan error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );

    await expect(scanServer()).rejects.toThrow('server_harness_invalid_response');
  });
});

describe('buildPlatformAgencyConfig', () => {
  it('uses the default local target without binding a device for this computer', () => {
    expect(buildPlatformAgencyConfig('openclaw', { kind: 'local' })).toEqual({
      heterogeneousProvider: { type: 'openclaw' },
    });
  });

  it('uses the trusted server target without binding a user device', () => {
    expect(buildPlatformAgencyConfig('openclaw', { kind: 'server' })).toEqual({
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'openclaw' },
      serverHarness: true,
    });
  });

  it('binds a selected remote device explicitly', () => {
    expect(
      buildPlatformAgencyConfig('hermes', { deviceId: 'remote-device', kind: 'device' }),
    ).toEqual({
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'hermes' },
    });
  });
});

describe('buildConnectAgentConfig', () => {
  it('stores a customized label as the personal name without overwriting the platform profile', () => {
    const provider = getConnectableProvider('hermes')!;

    expect(
      buildConnectAgentConfig({
        overrides: { description: ' Custom description ', name: ' Research Agent ' },
        profile: { description: 'Profile description', title: 'default' },
        provider,
        target: { kind: 'local' },
      }),
    ).toMatchObject({
      description: 'Custom description',
      name: 'Research Agent',
      title: 'default',
    });
  });

  it('stamps the runtime type as the agent provider for platform agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('hermes')!,
        target: { kind: 'local' },
      }),
    ).toMatchObject({ provider: 'hermes' });
  });

  it('stamps the runtime type as the agent provider for CLI agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('claude-code')!,
        target: { deviceId: 'device-1', kind: 'device' },
      }),
    ).toMatchObject({ provider: 'claude-code' });
  });

  it('creates a server-managed Codex agent without a device binding', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('codex')!,
        target: { kind: 'server' },
      }),
    ).toMatchObject({
      agencyConfig: {
        executionTarget: 'sandbox',
        heterogeneousProvider: { command: 'codex', type: 'codex' },
        serverHarness: true,
      },
      provider: 'codex',
    });
  });

  it('stores only a provider/model reference for a server-managed agent', () => {
    expect(
      buildConnectAgentConfig({
        apiConfig: { model: 'gpt-5.6-codex', providerId: 'openai' },
        provider: getConnectableProvider('codex')!,
        target: { kind: 'server' },
      }),
    ).toMatchObject({
      agencyConfig: {
        heterogeneousProvider: {
          apiConfig: { model: 'gpt-5.6-codex', providerId: 'openai' },
          authMode: 'api',
          type: 'codex',
        },
        serverHarness: true,
      },
    });
  });
});
