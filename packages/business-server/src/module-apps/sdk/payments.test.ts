import type { ModuleAppCapabilityClaims } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppPaymentsGateway } from './payments';

const capability: ModuleAppCapabilityClaims = {
  appId: '00000000-0000-4000-8000-000000000001',
  aud: 'module-runtime',
  exp: 1_900_000_000,
  iat: 1_800_000_000,
  installationId: '00000000-0000-4000-8000-000000000002',
  nonce: '0123456789abcdef0123456789abcdef',
  permissions: ['payments.catalog.read', 'payments.checkout'],
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

describe('ModuleAppPaymentsGateway', () => {
  it('passes a validated checkout request without exposing a payment credential surface', async () => {
    const adapter = {
      createCheckout: vi.fn().mockResolvedValue({
        checkout: { type: 'redirect', url: 'https://pay.example.com/checkout' },
        method: 'alipay',
        orderId: '00000000-0000-4000-8000-000000000004',
        outTradeNo: 'module-app-order-1',
        provider: 'alipay',
      }),
      getOrderStatus: vi.fn(),
      listCatalog: vi.fn(),
      listMethods: vi.fn(),
    };
    const gateway = new ModuleAppPaymentsGateway(adapter);

    await expect(
      gateway.createCheckout({
        capability,
        context,
        payload: {
          idempotencyKey: '00000000-0000-4000-8000-000000000005',
          method: 'alipay',
          productId: '00000000-0000-4000-8000-000000000006',
        },
        requestId: 'checkout-1',
      }),
    ).resolves.toMatchObject({ provider: 'alipay' });

    expect(adapter.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ method: 'alipay' }),
        requestId: 'checkout-1',
      }),
    );
  });

  it('rejects malformed checkout input before delegation', async () => {
    const adapter = {
      createCheckout: vi.fn(),
      getOrderStatus: vi.fn(),
      listCatalog: vi.fn(),
      listMethods: vi.fn(),
    };
    const gateway = new ModuleAppPaymentsGateway(adapter);

    await expect(
      gateway.createCheckout({
        capability,
        context,
        payload: { productId: '00000000-0000-4000-8000-000000000006' },
        requestId: 'checkout-2',
      }),
    ).rejects.toThrow();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});
