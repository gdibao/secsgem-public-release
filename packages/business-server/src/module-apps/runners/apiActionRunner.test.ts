import type { ModuleAppActionConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { runModuleAppApiAction } from './apiActionRunner';

const action: ModuleAppActionConfig = {
  id: 'lookup',
  inputSchema: { fields: [] },
  moduleMultiplier: 1,
  name: 'Lookup',
  outputSchema: {},
  runtimeConfig: {
    bodyTemplate: { keyword: '{{keyword}}', token: '{{apiKey}}' },
    headers: { Authorization: 'Bearer {{apiKey}}' },
    method: 'POST',
    responsePath: 'data.summary',
    url: 'https://api.example.com/search',
  },
  runtimeType: 'api_action',
};

describe('runModuleAppApiAction', () => {
  it('runs a templated API request and redacts secret values from snapshots', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { summary: 'fruit' } }),
    });

    const result = await runModuleAppApiAction({
      action,
      fetchImpl,
      input: { keyword: 'apple' },
      outboundHosts: ['api.example.com'],
      resolvedSecrets: { apiKey: 'secret-token' },
      resolveHostname: () => ['93.184.216.34'],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/search',
      expect.objectContaining({
        body: JSON.stringify({ keyword: 'apple', token: 'secret-token' }),
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
        redirect: 'error',
      }),
    );
    expect(result).toMatchObject({
      actualAiCredits: 0,
      artifacts: [],
      preview: 'fruit',
    });
    expect(result.output).toMatchObject({
      request: {
        body: JSON.stringify({ keyword: 'apple', token: '[REDACTED]' }),
        headers: { 'Authorization': '[REDACTED]', 'Content-Type': 'application/json' },
        method: 'POST',
        url: 'https://api.example.com/search',
      },
      response: {
        body: { data: { summary: 'fruit' } },
        status: 200,
      },
    });
  });

  it('rejects missing API URLs', async () => {
    await expect(
      runModuleAppApiAction({
        action: { ...action, runtimeConfig: {}, runtimeType: 'api_action' },
        fetchImpl: vi.fn(),
        input: {},
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_ACTION_NOT_CONFIGURED');
  });

  it('rejects a rendered host outside the reviewed outbound host list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await expect(
      runModuleAppApiAction({
        action: {
          ...action,
          runtimeConfig: { ...action.runtimeConfig, url: 'https://{{host}}/search' },
        },
        fetchImpl,
        input: { host: 'unreviewed.example.com' },
        outboundHosts: ['api.example.com'],
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_HOST_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects forbidden transport headers before dispatch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runModuleAppApiAction({
        action: {
          ...action,
          runtimeConfig: {
            ...action.runtimeConfig,
            headers: { Host: 'api.example.com' },
          },
        },
        fetchImpl,
        input: {},
        outboundHosts: ['api.example.com'],
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_HEADERS_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects header values containing line breaks before dispatch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runModuleAppApiAction({
        action: {
          ...action,
          runtimeConfig: {
            ...action.runtimeConfig,
            headers: { 'X-Module-App': 'safe\r\nHost: internal.example.com' },
          },
        },
        fetchImpl,
        input: {},
        outboundHosts: ['api.example.com'],
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_HEADERS_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized rendered request bodies before dispatch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runModuleAppApiAction({
        action: {
          ...action,
          runtimeConfig: {
            ...action.runtimeConfig,
            bodyTemplate: { payload: 'x'.repeat(256 * 1024 + 1) },
          },
        },
        fetchImpl,
        input: {},
        outboundHosts: ['api.example.com'],
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_BODY_TOO_LARGE');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires HTTPS whenever resolved installation secrets are present', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runModuleAppApiAction({
        action: {
          ...action,
          runtimeConfig: { ...action.runtimeConfig, url: 'http://api.example.com/search' },
        },
        fetchImpl,
        input: {},
        resolvedSecrets: { apiKey: 'secret-token' },
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_SECRET_REQUIRES_HTTPS');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('binds dispatch to the vetted DNS result without resolving the hostname again', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const dispatcher = { close } as never;
    const createDispatcher = vi.fn(() => dispatcher);
    const resolveHostname = vi
      .fn()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1']);
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await runModuleAppApiAction({
      action,
      createDispatcher,
      fetchImpl,
      input: {},
      outboundHosts: ['api.example.com'],
      resolveHostname,
    });

    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(createDispatcher).toHaveBeenCalledWith({
      addresses: ['93.184.216.34'],
      hostname: 'api.example.com',
      url: 'https://api.example.com/search',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/search',
      expect.objectContaining({ dispatcher }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stops reading responses larger than one MiB', async () => {
    const response = new Response('x'.repeat(1024 * 1024 + 1), {
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });

    await expect(
      runModuleAppApiAction({
        action,
        fetchImpl: vi.fn().mockResolvedValue(response),
        input: {},
        outboundHosts: ['api.example.com'],
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_RESPONSE_TOO_LARGE');
  });

  it('fails closed when the approved outbound host list is absent', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runModuleAppApiAction({
        action,
        fetchImpl,
        input: {},
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_API_HOST_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not duplicate an explicitly configured content-type header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await runModuleAppApiAction({
      action: {
        ...action,
        runtimeConfig: {
          ...action.runtimeConfig,
          headers: { 'content-type': 'application/vnd.module-app+json' },
        },
      },
      fetchImpl,
      input: {},
      outboundHosts: ['api.example.com'],
      resolveHostname: () => ['93.184.216.34'],
    });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).toEqual({ 'content-type': 'application/vnd.module-app+json' });
  });
});
