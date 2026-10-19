import { describe, expect, it, vi } from 'vitest';

import {
  resolveModuleAppActionOutboundHosts,
  resolveModuleAppActionSecrets,
  resolveModuleAppWorkflowAction,
} from './actionDependencies';

const workflow = {
  edges: [],
  key: 'candidate_review',
  nodes: [
    {
      config: {},
      key: 'load',
      retry: { initialDelayMs: 1000, maxAttempts: 1, multiplier: 2 },
      timeoutMs: 30_000,
      type: 'function' as const,
    },
  ],
  startNodeKey: 'load',
  version: 1,
};

describe('module app action dependencies', () => {
  it('resolves only general-purpose reviewed hosts from the immutable runtime manifest', () => {
    expect(
      resolveModuleAppActionOutboundHosts({
        runtimeManifest: {
          outboundHostPolicies: [
            { host: 'api.example.com', purpose: 'general' },
            { host: 'models.example.com', purpose: 'ai' },
            { host: 'checkout.example.com', purpose: 'payment' },
          ],
          runtime: {
            outboundHosts: ['api.example.com', 'models.example.com', 'checkout.example.com'],
          },
        },
      }),
    ).toEqual(['api.example.com']);
    expect(
      resolveModuleAppActionOutboundHosts({
        runtimeManifest: { runtime: { outboundHosts: ['unreviewed.example.com'] } },
      }),
    ).toEqual([]);
  });

  it('resolves the configured workflow from the immutable runtime manifest', () => {
    expect(
      resolveModuleAppWorkflowAction({
        action: {
          id: 'workflow',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Workflow',
          outputSchema: {},
          runtimeConfig: { workflowKey: 'candidate_review', workflowVersion: 1 },
          runtimeType: 'workflow_step',
        },
        runtimeManifest: { runtime: { workflows: [workflow] } },
      }),
    ).toEqual(workflow);
  });

  it('decrypts only explicitly declared installation secret keys', async () => {
    const getEncryptedValue = vi.fn().mockResolvedValue('encrypted-api-key');
    const decrypt = vi.fn().mockResolvedValue({ plaintext: 'secret-value', wasAuthentic: true });

    await expect(
      resolveModuleAppActionSecrets({
        action: {
          id: 'lookup',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Lookup',
          outputSchema: {},
          runtimeConfig: { secretKeys: ['API_KEY'] },
          runtimeType: 'api_action',
        },
        decrypt,
        getEncryptedValue,
        installationId: 'installation-1',
      }),
    ).resolves.toEqual({ API_KEY: 'secret-value' });
    expect(getEncryptedValue).toHaveBeenCalledWith({
      installationId: 'installation-1',
      key: 'API_KEY',
    });
  });

  it('rejects workflow references that do not match the immutable manifest version', () => {
    expect(() =>
      resolveModuleAppWorkflowAction({
        action: {
          id: 'workflow',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Workflow',
          outputSchema: {},
          runtimeConfig: { workflowKey: 'candidate_review', workflowVersion: 2 },
          runtimeType: 'workflow_step',
        },
        runtimeManifest: { runtime: { workflows: [workflow] } },
      }),
    ).toThrow('MODULE_APP_WORKFLOW_RUNTIME_REQUIRED');
  });

  it('rejects invalid or missing declared installation secrets', async () => {
    const action = {
      id: 'lookup',
      inputSchema: { fields: [] },
      moduleMultiplier: 1,
      name: 'Lookup',
      outputSchema: {},
      runtimeType: 'api_action' as const,
    };

    await expect(
      resolveModuleAppActionSecrets({
        action: { ...action, runtimeConfig: { secretKeys: ['lowercase'] } },
        decrypt: vi.fn(),
        getEncryptedValue: vi.fn(),
        installationId: 'installation-1',
      }),
    ).rejects.toThrow('MODULE_APP_SECRET_KEYS_INVALID');

    await expect(
      resolveModuleAppActionSecrets({
        action: { ...action, runtimeConfig: { secretKeys: ['API_KEY'] } },
        decrypt: vi.fn(),
        getEncryptedValue: vi.fn().mockResolvedValue(null),
        installationId: 'installation-1',
      }),
    ).rejects.toThrow('MODULE_APP_SECRET_REQUIRED:API_KEY');
  });
});
