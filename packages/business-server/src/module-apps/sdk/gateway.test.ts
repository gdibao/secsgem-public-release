import type { ModuleAppCapabilityClaims } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppFileGateway } from './files';
import { ModuleAppCapabilityGateway, ModuleAppReplayGuard } from './gateway';
import { ModuleAppHttpGateway } from './http';
import { ModuleAppNotificationGateway, ModuleAppNotificationRateLimiter } from './notifications';
import { ModuleAppSecretsGateway } from './secrets';

const INSTALLATION_ID = '00000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000002';
const VERSION_ID = '00000000-0000-4000-8000-000000000003';
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const claims = (
  permissions: string[],
  surface: 'browser' | 'runtime' = 'browser',
): ModuleAppCapabilityClaims => ({
  appId: APP_ID,
  aud: 'module-runtime',
  exp: NOW_SECONDS + 300,
  iat: NOW_SECONDS,
  installationId: INSTALLATION_ID,
  nonce: '0123456789abcdef0123456789abcdef',
  permissions,
  surface,
  userId: 'user-1',
  versionId: VERSION_ID,
});

const createGateway = (
  httpOverride?: ModuleAppHttpGateway,
  guards: {
    notificationRateLimiter?: ModuleAppNotificationRateLimiter;
    replayGuard?: ModuleAppReplayGuard;
  } = {},
) => {
  const storage = {
    createPrivatePreSignedUpload: vi.fn().mockResolvedValue({
      url: 'https://storage.example.com/upload',
    }),
    createPreSignedUrlForPreview: vi.fn().mockResolvedValue('https://storage.example.com/download'),
  };
  const files = new ModuleAppFileGateway({ randomId: () => 'file-1', storage: storage as never });
  const http = new ModuleAppHttpGateway({
    fetch: vi.fn(),
    resolveHostname: () => ['93.184.216.34'],
  });
  const notifications = new ModuleAppNotificationGateway({
    create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
    rateLimiter: guards.notificationRateLimiter,
  });
  const secrets = new ModuleAppSecretsGateway({
    decrypt: vi.fn().mockResolvedValue({ plaintext: 'secret-value', wasAuthentic: true }),
    getEncryptedValue: vi.fn().mockResolvedValue('encrypted-value'),
  });
  const data = {
    archive: vi.fn(),
    get: vi.fn(),
    insert: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    transaction: vi.fn(),
    update: vi.fn(),
  };
  const tasks = {
    cancel: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
  };
  const ai = {
    chat: vi.fn().mockResolvedValue({
      actualAiCredits: 1,
      model: 'gpt-4.1-mini',
      text: 'Managed response',
      tokenUsage: { input: 4, output: 2, total: 6 },
    }),
    listModels: vi.fn().mockResolvedValue([{ abilities: [], id: 'gpt-4.1-mini', type: 'chat' }]),
  };
  const payments = {
    createCheckout: vi.fn().mockResolvedValue({
      checkout: { type: 'redirect', url: 'https://pay.example.com/checkout' },
      method: 'alipay',
      orderId: '00000000-0000-4000-8000-000000000004',
      outTradeNo: 'module-app-order-1',
      provider: 'alipay',
    }),
    getOrderStatus: vi.fn().mockResolvedValue({
      method: 'alipay',
      paymentStatus: 'pending',
      provider: 'alipay',
      status: 'pending',
    }),
    listCatalog: vi.fn().mockResolvedValue([]),
    listMethods: vi.fn().mockResolvedValue([{ id: 'alipay', label: 'Alipay', provider: 'alipay' }]),
  };
  const gateway = new ModuleAppCapabilityGateway({
    ai: ai as never,
    context: {
      resolve: vi.fn().mockResolvedValue({
        appId: APP_ID,
        displayName: 'Example App',
        installationId: INSTALLATION_ID,
        outboundHosts: ['api.example.com'],
        secretKeys: ['CRM_TOKEN'],
        scopeType: 'personal',
        userId: 'user-1',
        versionId: VERSION_ID,
      }),
    },
    data: data as never,
    files,
    http: httpOverride ?? http,
    notifications,
    payments: payments as never,
    replayGuard: guards.replayGuard ?? new ModuleAppReplayGuard(),
    secrets,
    tasks: tasks as never,
  });

  return { ai, data, gateway, payments, storage, tasks };
};

describe('ModuleAppCapabilityGateway', () => {
  it('denies methods missing from the reviewed capability', async () => {
    const { gateway } = createGateway();

    await expect(
      gateway.call({
        capability: claims(['data.read']),
        input: { fileName: 'report.csv' },
        method: 'files.createUpload',
        requestId: 'request-1',
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_DENIED');
  });

  it('routes AI calls only through the permissioned managed gateway', async () => {
    const { ai, gateway } = createGateway();
    await expect(
      gateway.call({
        capability: claims([]),
        input: { messages: [{ content: 'hello', role: 'user' }], model: 'gpt-4.1-mini' },
        method: 'ai.chat',
        requestId: 'ai-request-1',
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_DENIED');

    await expect(
      gateway.call({
        capability: claims(['ai.chat']),
        input: { messages: [{ content: 'hello', role: 'user' }], model: 'gpt-4.1-mini' },
        method: 'ai.chat',
        requestId: 'ai-request-2',
      }),
    ).resolves.toMatchObject({ text: 'Managed response' });
    expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'ai-request-2' }));
  });

  it('requires checkout permission and makes checkout calls replay-safe', async () => {
    const { gateway, payments } = createGateway();
    const input = {
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      productId: '00000000-0000-4000-8000-000000000002',
    };

    await expect(
      gateway.call({
        capability: claims([]),
        input,
        method: 'payments.checkout.create',
        requestId: 'checkout-request-1',
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_DENIED');

    const request = {
      capability: claims(['payments.checkout']),
      input,
      method: 'payments.checkout.create' as const,
      requestId: 'checkout-request-2',
    };
    await expect(gateway.call(request)).resolves.toMatchObject({ provider: 'alipay' });
    await expect(gateway.call(request)).rejects.toThrow('MODULE_APP_CAPABILITY_REPLAYED');
    expect(payments.createCheckout).toHaveBeenCalledOnce();
  });

  it('never returns secret plaintext to a browser capability', async () => {
    const { gateway } = createGateway();

    await expect(
      gateway.call({
        capability: claims(['secrets.read']),
        input: { key: 'CRM_TOKEN' },
        method: 'secrets.get',
      }),
    ).resolves.toEqual({ configured: true });
    await expect(
      gateway.call({
        capability: claims(['secrets.read'], 'runtime'),
        input: { key: 'CRM_TOKEN' },
        method: 'secrets.get',
      }),
    ).resolves.toEqual({ configured: true, value: 'secret-value' });
  });

  it('rejects secret keys not declared by the installed version', async () => {
    const { gateway } = createGateway();

    await expect(
      gateway.call({
        capability: claims(['secrets.read'], 'runtime'),
        input: { key: 'UNDECLARED_TOKEN' },
        method: 'secrets.get',
      }),
    ).rejects.toThrow('MODULE_APP_SECRET_NOT_DECLARED');
  });

  it('keeps internal secret declarations out of the serialized module context', async () => {
    const { gateway } = createGateway();

    const context = await gateway.call({
      capability: claims([]),
      method: 'context.get',
    });

    expect(context).not.toHaveProperty('secretKeys');
  });

  it('binds file keys to one installation and rejects cross-installation downloads', async () => {
    const { gateway, storage } = createGateway();

    await expect(
      gateway.call({
        capability: claims(['files.write']),
        input: { fileName: 'report.csv' },
        method: 'files.createUpload',
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      key: `${INSTALLATION_ID}/files/file-1.csv`,
      uploadUrl: 'https://storage.example.com/upload',
    });
    expect(storage.createPrivatePreSignedUpload).toHaveBeenCalledWith(
      `module-app-installations/${INSTALLATION_ID}/files/file-1.csv`,
    );

    await expect(
      gateway.call({
        capability: claims(['files.read']),
        input: { key: '00000000-0000-4000-8000-000000000099/files/stolen.csv' },
        method: 'files.createDownload',
      }),
    ).rejects.toThrow('MODULE_APP_FILE_SCOPE_DENIED');
  });

  it('applies the SSRF guard even when the host was reviewed', async () => {
    const unsafeHttp = new ModuleAppHttpGateway({
      fetch: vi.fn(),
      resolveHostname: () => ['169.254.169.254'],
    });
    const { gateway } = createGateway(unsafeHttp);

    await expect(
      gateway.call({
        capability: claims(['http.fetch']),
        input: { url: 'https://api.example.com/private' },
        method: 'http.fetch',
        requestId: 'request-2',
      }),
    ).rejects.toThrow('MODULE_APP_UNSAFE_API_URL');
  });

  it('requires HTTPS for capability HTTP requests', async () => {
    const fetch = vi.fn();
    const http = new ModuleAppHttpGateway({
      fetch,
      resolveHostname: () => ['93.184.216.34'],
    });
    const { gateway } = createGateway(http);

    await expect(
      gateway.call({
        capability: claims(['http.fetch']),
        input: { url: 'http://api.example.com/plaintext' },
        method: 'http.fetch',
        requestId: 'request-http',
      }),
    ).rejects.toThrow('MODULE_APP_HTTP_HTTPS_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds capability HTTP dispatch to the vetted DNS result', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const dispatcher = { close } as never;
    const createDispatcher = vi.fn(() => dispatcher);
    const fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const resolveHostname = vi
      .fn()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1']);
    const http = new ModuleAppHttpGateway({ createDispatcher, fetch, resolveHostname });
    const { gateway } = createGateway(http);

    await expect(
      gateway.call({
        capability: claims(['http.fetch']),
        input: { url: 'https://api.example.com/public' },
        method: 'http.fetch',
        requestId: 'request-pinned-http',
      }),
    ).resolves.toMatchObject({ body: 'ok', status: 200 });
    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(createDispatcher).toHaveBeenCalledWith({
      addresses: ['93.184.216.34'],
      hostname: 'api.example.com',
      url: 'https://api.example.com/public',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/public',
      expect.objectContaining({ dispatcher }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects replayed mutation request ids for the same launch nonce', async () => {
    const { gateway } = createGateway();
    const call = () =>
      gateway.call({
        capability: claims(['notifications.write']),
        input: { content: 'Build complete', title: 'Done' },
        method: 'notifications.create' as const,
        requestId: 'request-replay',
      });

    await expect(call()).resolves.toMatchObject({ id: 'notification-1' });
    await expect(call()).rejects.toThrow('MODULE_APP_CAPABILITY_REPLAYED');
  });

  it('rate limits notifications per installation across distinct request ids', async () => {
    const { gateway } = createGateway();

    for (let index = 0; index < 10; index++) {
      await gateway.call({
        capability: claims(['notifications.write']),
        input: { content: 'Build complete', title: 'Done' },
        method: 'notifications.create',
        requestId: `request-${index}`,
      });
    }

    await expect(
      gateway.call({
        capability: claims(['notifications.write']),
        input: { content: 'One too many', title: 'Denied' },
        method: 'notifications.create',
        requestId: 'request-11',
      }),
    ).rejects.toThrow('MODULE_APP_NOTIFICATION_RATE_LIMITED');
  });

  it('rejects replay across gateway instances sharing a distributed guard backend', async () => {
    const consumed = new Set<string>();
    const backend = {
      consume: vi.fn(async (key: string) => {
        if (consumed.has(key)) return false;
        consumed.add(key);
        return true;
      }),
    };
    const first = createGateway(undefined, {
      replayGuard: new ModuleAppReplayGuard({ backend }),
    }).gateway;
    const second = createGateway(undefined, {
      replayGuard: new ModuleAppReplayGuard({ backend }),
    }).gateway;
    const input = {
      capability: claims(['notifications.write']),
      input: { content: 'Build complete', title: 'Done' },
      method: 'notifications.create' as const,
      requestId: 'distributed-replay',
    };

    await expect(first.call(input)).resolves.toMatchObject({ id: 'notification-1' });
    await expect(second.call(input)).rejects.toThrow('MODULE_APP_CAPABILITY_REPLAYED');
  });

  it('rate limits across gateway instances sharing a distributed limiter backend', async () => {
    const counts = new Map<string, number>();
    const backend = {
      consume: vi.fn(async (installationId: string, limit: number) => {
        const next = (counts.get(installationId) ?? 0) + 1;
        counts.set(installationId, next);
        return next <= limit;
      }),
    };
    const first = createGateway(undefined, {
      notificationRateLimiter: new ModuleAppNotificationRateLimiter({ backend }),
    }).gateway;
    const second = createGateway(undefined, {
      notificationRateLimiter: new ModuleAppNotificationRateLimiter({ backend }),
    }).gateway;

    for (let index = 0; index < 10; index++) {
      await (index % 2 === 0 ? first : second).call({
        capability: claims(['notifications.write']),
        input: { content: 'Build complete', title: 'Done' },
        method: 'notifications.create',
        requestId: `distributed-rate-${index}`,
      });
    }

    await expect(
      second.call({
        capability: claims(['notifications.write']),
        input: { content: 'One too many', title: 'Denied' },
        method: 'notifications.create',
        requestId: 'distributed-rate-11',
      }),
    ).rejects.toThrow('MODULE_APP_NOTIFICATION_RATE_LIMITED');
  });

  it('rejects an oversized HTTP response before reading its body', async () => {
    const oversizedHttp = new ModuleAppHttpGateway({
      fetch: vi.fn().mockResolvedValue(
        new Response('not read', {
          headers: { 'content-length': String(1024 * 1024 + 1) },
          status: 200,
        }),
      ),
      resolveHostname: () => ['93.184.216.34'],
    });
    const { gateway } = createGateway(oversizedHttp);

    await expect(
      gateway.call({
        capability: claims(['http.fetch']),
        input: { url: 'https://api.example.com/large' },
        method: 'http.fetch',
        requestId: 'request-large',
      }),
    ).rejects.toThrow('MODULE_APP_HTTP_RESPONSE_TOO_LARGE');
  });

  it('routes managed data reads through the installation capability', async () => {
    const { data, gateway } = createGateway();
    await expect(
      gateway.call({
        capability: claims(['data.read']),
        input: { tableKey: 'candidates' },
        method: 'data.list',
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(data.list).toHaveBeenCalledWith({
      capability: expect.objectContaining({ installationId: INSTALLATION_ID }),
      input: { tableKey: 'candidates' },
    });
  });

  it('requires unique request ids for managed data mutations', async () => {
    const { data, gateway } = createGateway();
    data.insert.mockResolvedValue({ rowKey: 'candidate-1' });
    const call = () =>
      gateway.call({
        capability: claims(['data.write']),
        input: { tableKey: 'candidates', values: { email: 'one@example.com' } },
        method: 'data.insert',
        requestId: 'data-request-1',
      });

    await expect(call()).resolves.toMatchObject({ rowKey: 'candidate-1' });
    await expect(call()).rejects.toThrow('MODULE_APP_CAPABILITY_REPLAYED');
    expect(data.insert).toHaveBeenCalledOnce();
  });

  it('routes installation-bound task reads and protects cancellation from replay', async () => {
    const { gateway, tasks } = createGateway();
    await expect(
      gateway.call({
        capability: claims(['tasks.read']),
        input: { runId: 'run-1' },
        method: 'tasks.getRun',
      }),
    ).resolves.toMatchObject({ id: 'run-1' });
    const cancel = () =>
      gateway.call({
        capability: claims(['tasks.write']),
        input: { runId: 'run-1' },
        method: 'tasks.cancel' as const,
        requestId: 'cancel-1',
      });
    await expect(cancel()).resolves.toMatchObject({ status: 'cancelled' });
    await expect(cancel()).rejects.toThrow('MODULE_APP_CAPABILITY_REPLAYED');
    expect(tasks.getRun).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: expect.objectContaining({ installationId: INSTALLATION_ID }),
      }),
    );
  });
});
