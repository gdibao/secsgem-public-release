import type { ModuleAppCapabilityClaims } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppAiGateway } from './ai';

const capability: ModuleAppCapabilityClaims = {
  appId: '00000000-0000-4000-8000-000000000001',
  aud: 'module-runtime',
  exp: 1_900_000_000,
  iat: 1_800_000_000,
  installationId: '00000000-0000-4000-8000-000000000002',
  nonce: '0123456789abcdef0123456789abcdef',
  permissions: ['ai.chat', 'ai.models.read'],
  surface: 'browser',
  userId: 'user-1',
  versionId: '00000000-0000-4000-8000-000000000003',
};

const context = {
  appId: capability.appId,
  displayName: 'Example App',
  installationId: capability.installationId,
  outboundHosts: [],
  secretKeys: [],
  scopeType: 'personal' as const,
  versionId: capability.versionId,
};

describe('ModuleAppAiGateway', () => {
  it('validates chat input and delegates the capability-bound request', async () => {
    const adapter = {
      chat: vi.fn().mockResolvedValue({
        actualAiCredits: 1.25,
        model: 'gpt-4.1-mini',
        text: 'Managed response',
        tokenUsage: { input: 8, output: 4, total: 12 },
      }),
      listModels: vi.fn(),
    };
    const gateway = new ModuleAppAiGateway(adapter);

    await expect(
      gateway.chat({
        capability,
        context,
        payload: {
          messages: [{ content: 'Summarize this text.', role: 'user' }],
          model: 'gpt-4.1-mini',
          temperature: 0.2,
        },
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({ text: 'Managed response' });

    expect(adapter.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        capability,
        context,
        input: expect.objectContaining({ model: 'gpt-4.1-mini', temperature: 0.2 }),
        requestId: 'request-1',
      }),
    );
  });

  it('rejects provider and credential fields before they reach the server adapter', async () => {
    const adapter = { chat: vi.fn(), listModels: vi.fn() };
    const gateway = new ModuleAppAiGateway(adapter);

    await expect(
      gateway.chat({
        capability,
        context,
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-4.1-mini',
          provider: 'openai',
        },
        requestId: 'request-2',
      }),
    ).rejects.toThrow();
    expect(adapter.chat).not.toHaveBeenCalled();
  });
});
