import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelServerHarnessRun, startServerHarnessRun } from './serverHarnessClient';

describe('serverHarnessClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts a run with the operation token only in the authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await startServerHarnessRun({
      gatewayUrl: 'http://harness.internal:41880',
      operationToken: 'operation-secret',
      run: {
        agentType: 'codex',
        assistantMessageId: 'message-1',
        model: { id: 'gpt-5.6-codex', providerId: 'openai' },
        operationId: 'operation-1',
        prompt: 'hello',
        topicId: 'topic-1',
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe('http://harness.internal:41880/v1/runs');
    expect(init.headers.authorization).toBe('Bearer operation-secret');
    expect(init.body).not.toContain('operation-secret');
    expect(JSON.parse(init.body)).toMatchObject({
      model: { id: 'gpt-5.6-codex', providerId: 'openai' },
    });
  });

  it('does not claim cancellation when the trusted worker refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(
      cancelServerHarnessRun({
        gatewayUrl: 'http://harness.internal:41880',
        operationId: 'operation-1',
        operationToken: 'operation-secret',
      }),
    ).resolves.toBe(false);
  });
});
