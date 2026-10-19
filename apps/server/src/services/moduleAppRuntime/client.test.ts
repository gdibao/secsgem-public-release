import { createHmac } from 'node:crypto';

import {
  MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER,
  MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT,
  MODULE_APP_RUNTIME_READINESS_PROOF_HEADER,
} from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppRuntimeClient } from './client';

const invocation = {
  artifactSha256: 'a'.repeat(64),
  capability: 'signed-runtime-capability',
  entry: 'server/search.ts',
  input: { query: 'jobs' },
  invocationId: '00000000-0000-4000-8000-000000000001',
  runtime: 'node22' as const,
  timeoutMs: 1000,
};

describe('ModuleAppRuntimeClient', () => {
  it('reports only secret-free runtime configuration metadata', () => {
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://operator:password@module-runtime:3210',
      internalToken: 'internal-token',
    });

    const status = client.getConfigurationStatus();
    expect(status).toEqual({ internalTokenConfigured: true, internalUrlConfigured: true });
    expect(JSON.stringify(status)).not.toContain('internal-token');
    expect(JSON.stringify(status)).not.toContain('operator:password');
  });

  it('authenticates readiness with a challenge proof without sending the internal token', async () => {
    const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      const challenge = new Headers(init?.headers).get(
        MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER,
      );
      if (!challenge) throw new Error('readiness challenge missing');
      const proof = createHmac('sha256', 'internal-token')
        .update(MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT)
        .update('\0')
        .update(challenge)
        .digest('base64url');
      return new Response(JSON.stringify({ status: 'ready' }), {
        headers: { [MODULE_APP_RUNTIME_READINESS_PROOF_HEADER]: proof },
        status: 200,
      });
    });
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      fetch,
      internalToken: 'internal-token',
    });

    await expect(client.healthCheck()).resolves.toEqual({ status: 'ready' });
    expect(fetch).toHaveBeenCalledWith('http://module-runtime:3210/ready', {
      headers: {
        [MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER]: expect.stringMatching(/^[\w-]{32}$/),
      },
      method: 'GET',
      signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('internal-token');
  });

  it('fails closed when a configured runtime does not prove token possession', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready' }), {
          headers: { [MODULE_APP_RUNTIME_READINESS_PROOF_HEADER]: 'invalid-proof' },
          status: 200,
        }),
      );
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      fetch,
      internalToken: 'internal-token',
    });

    await expect(client.healthCheck()).resolves.toEqual({
      code: 'MODULE_APP_RUNTIME_AUTH_FAILED',
      status: 'unavailable',
    });
    await expect(client.healthCheck()).resolves.toEqual({
      code: 'MODULE_APP_RUNTIME_AUTH_FAILED',
      status: 'unavailable',
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('internal-token');
  });

  it('preserves bounded runtime failure codes and rejects unexpected probe payloads', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
            status: 'unavailable',
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '/private/docker.sock', status: 'unavailable' }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'MODULE_APP_RUNTIME_AUTH_FAILED',
            status: 'unavailable',
          }),
          { status: 401 },
        ),
      );
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      fetch,
    });

    await expect(client.healthCheck()).resolves.toEqual({
      code: 'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
      status: 'unavailable',
    });
    await expect(client.healthCheck()).resolves.toEqual({
      code: 'MODULE_APP_RUNTIME_PROBE_INVALID',
      status: 'unavailable',
    });
    await expect(client.healthCheck()).resolves.toEqual({
      code: 'MODULE_APP_RUNTIME_AUTH_FAILED',
      status: 'unavailable',
    });
  });

  it('bounds stalled readiness probes independently from invocation timeouts', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      fetch,
      healthCheckTimeoutMs: 250,
    });

    try {
      const probe = client.healthCheck();
      await vi.advanceTimersByTimeAsync(250);
      await expect(probe).resolves.toEqual({
        code: 'MODULE_APP_RUNTIME_PROBE_TIMEOUT',
        status: 'unavailable',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses invocation while module app execution is disabled', async () => {
    const fetch = vi.fn();
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      enabled: false,
      fetch,
      internalToken: 'internal-token',
    });

    await expect(client.invoke(invocation)).rejects.toThrow('MODULE_APP_EXECUTION_DISABLED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses invocation while the runtime invocation rollout is disabled', async () => {
    const fetch = vi.fn();
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      enabled: true,
      fetch,
      internalToken: 'internal-token',
      invocationEnabled: false,
    });

    await expect(client.invoke(invocation)).rejects.toThrow(
      'MODULE_APP_RUNTIME_INVOCATION_DISABLED',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an enabled invocation only to the configured internal endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          invocationId: invocation.invocationId,
          output: {},
          status: 'succeeded',
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      enabled: true,
      fetch,
      internalToken: 'internal-token',
      invocationEnabled: true,
    });

    await expect(client.invoke(invocation)).resolves.toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledWith(
      'http://module-runtime:3210/v1/invocations',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer internal-token' }),
        method: 'POST',
      }),
    );
  });

  it('aborts a stalled runtime request at the invocation timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const client = new ModuleAppRuntimeClient({
      baseUrl: 'http://module-runtime:3210',
      enabled: true,
      fetch,
      internalToken: 'internal-token',
      invocationEnabled: true,
    });

    try {
      const request = expect(client.invoke(invocation)).rejects.toThrow(
        'MODULE_APP_RUNTIME_TIMEOUT',
      );
      await vi.advanceTimersByTimeAsync(invocation.timeoutMs);

      await request;
      expect(fetch).toHaveBeenCalledWith(
        'http://module-runtime:3210/v1/invocations',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
