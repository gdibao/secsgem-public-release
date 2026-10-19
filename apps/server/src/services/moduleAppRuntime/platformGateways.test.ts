// @vitest-environment node
import { createHash } from 'node:crypto';

import type { ModuleAppCapabilityClaims } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createModuleAppAiGatewayAdapter,
  createModuleAppPaymentsGatewayAdapter,
} from './platformGateways';

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  createPayment: vi.fn(),
  createPaymentAdapter: vi.fn(),
  createTextGenerator: vi.fn(),
  generateText: vi.fn(),
  getAllEnabledModels: vi.fn(),
  getPaymentConfig: vi.fn(),
  isModelAllowedByPlanRules: vi.fn(),
  listCatalog: vi.fn(),
  resolvePaymentMethod: vi.fn(),
  resolvePlanModelRules: vi.fn(),
}));

vi.mock('@/business/server/module-apps/payments/service', () => ({
  ModuleAppPaymentService: vi
    .fn()
    .mockImplementation(() => ({ createPayment: mocks.createPayment })),
}));

vi.mock('@/business/server/planModelRules', () => ({
  isModelAllowedByPlanRules: mocks.isModelAllowedByPlanRules,
  resolvePlanModelRules: mocks.resolvePlanModelRules,
}));

vi.mock('@/database/models/moduleAppCommerce', () => ({
  ModuleAppCommerceModel: vi.fn().mockImplementation(() => ({
    createOrder: mocks.createOrder,
    listCatalog: mocks.listCatalog,
  })),
}));

vi.mock('@/database/models/moduleAppPayment', () => ({
  ModuleAppPaymentModel: vi.fn(),
}));

vi.mock('@/server/services/moduleAppAi', () => ({
  createModuleAppTextGenerator: mocks.createTextGenerator,
}));

vi.mock('@/server/services/newapiInstance', () => ({
  getAllEnabledModels: mocks.getAllEnabledModels,
}));

vi.mock('@/server/services/payments/config', () => ({
  buildPaymentCallbackUrl: vi.fn(() => 'https://chat.example.com/api/webhooks/payments/alipay'),
  buildPaymentReturnUrl: vi.fn(() => 'https://chat.example.com/apps'),
  getServerPaymentConfig: mocks.getPaymentConfig,
  listCheckoutPaymentMethods: vi.fn(),
  resolvePaymentMethod: mocks.resolvePaymentMethod,
}));

vi.mock('@/server/services/payments/factory', () => ({
  createPaymentAdapter: mocks.createPaymentAdapter,
}));

const capability: ModuleAppCapabilityClaims = {
  appId: '00000000-0000-4000-8000-000000000001',
  aud: 'module-runtime',
  exp: 1_900_000_000,
  iat: 1_800_000_000,
  installationId: '00000000-0000-4000-8000-000000000002',
  nonce: '0123456789abcdef0123456789abcdef',
  permissions: ['ai.chat', 'payments.checkout'],
  surface: 'browser',
  userId: 'user-1',
  versionId: '00000000-0000-4000-8000-000000000003',
};

const context = {
  appId: capability.appId,
  billing: {
    chargeMode: 'ai_usage' as const,
    defaultMultiplier: 1.25,
    externalApiCostCredits: 0,
    failureFixedFeePolicy: 'do_not_charge' as const,
    fixedServiceFeeCredits: 0,
  },
  displayName: 'Example App',
  installationId: capability.installationId,
  outboundHosts: [],
  scopeType: 'personal' as const,
  secretKeys: [],
  versionId: capability.versionId,
};
const rollout = { appIds: [capability.appId], publisherIds: ['publisher-1'] };

describe('module app platform gateway adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateText.mockResolvedValue({
      actualAiCredits: 1.25,
      text: 'Managed response',
      tokenUsage: { input: 8, output: 4, total: 12 },
    });
    mocks.createTextGenerator.mockReturnValue(mocks.generateText);
    mocks.getPaymentConfig.mockResolvedValue({
      enabled: true,
      moduleAppEnabled: true,
      publicBaseUrl: 'https://chat.example.com',
    });
    mocks.resolvePaymentMethod.mockReturnValue({ id: 'alipay', provider: 'alipay' });
    mocks.createPaymentAdapter.mockReturnValue({ method: 'alipay', provider: 'alipay' });
    mocks.listCatalog.mockResolvedValue([
      {
        amount: 99,
        licenseScope: 'personal',
        productId: '00000000-0000-4000-8000-000000000004',
      },
    ]);
    mocks.createOrder.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000005' });
    mocks.createPayment.mockResolvedValue({
      checkout: { type: 'redirect', url: 'https://pay.example.com/checkout' },
      method: 'alipay',
      outTradeNo: 'module-app-order-1',
      provider: 'alipay',
    });
  });

  it('forces SDK chat through the managed NewAPI generator and installation-bound usage key', async () => {
    const adapter = createModuleAppAiGatewayAdapter({ id: 'db' } as never);

    await expect(
      adapter.chat({
        capability,
        context,
        input: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4.1-mini',
        },
        requestId: 'chat-request-1',
      }),
    ).resolves.toMatchObject({ model: 'gpt-4.1-mini', text: 'Managed response' });

    expect(mocks.createTextGenerator).toHaveBeenCalledWith({
      db: { id: 'db' },
      workspaceId: undefined,
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        appMultiplier: 1.25,
        idempotencyKey: expect.stringMatching(/^sdk:[a-f0-9]{64}$/),
        provider: 'newapi',
      }),
    );
  });

  it('namespaces payment idempotency keys before creating an order', async () => {
    const adapter = createModuleAppPaymentsGatewayAdapter({ id: 'db' } as never, rollout);
    const idempotencyKey = '00000000-0000-4000-8000-000000000006';

    await expect(
      adapter.createCheckout({
        capability,
        context,
        input: {
          idempotencyKey,
          method: 'alipay',
          productId: '00000000-0000-4000-8000-000000000004',
        },
        requestId: 'checkout-request-1',
      }),
    ).resolves.toMatchObject({ orderId: '00000000-0000-4000-8000-000000000005' });

    const expectedIdempotencyKey = `sdk:${createHash('sha256')
      .update(`${context.installationId}:payment:${idempotencyKey}`)
      .digest('hex')}`;
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expectedIdempotencyKey,
        purchaserUserId: capability.userId,
        productId: '00000000-0000-4000-8000-000000000004',
      }),
    );
    expect(mocks.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: '00000000-0000-4000-8000-000000000005',
        purchaserUserId: capability.userId,
        rollout,
      }),
    );
  });

  it('requires a workspace administrator before creating a workspace checkout', async () => {
    const adapter = createModuleAppPaymentsGatewayAdapter({ id: 'db' } as never, rollout);

    await expect(
      adapter.createCheckout({
        capability,
        context: {
          ...context,
          scopeType: 'workspace',
          workspaceId: 'workspace-1',
          workspaceRole: 'member',
        },
        input: {
          idempotencyKey: '00000000-0000-4000-8000-000000000006',
          productId: '00000000-0000-4000-8000-000000000004',
        },
        requestId: 'checkout-request-2',
      }),
    ).rejects.toThrow('MODULE_APP_WORKSPACE_ADMIN_REQUIRED');
    expect(mocks.listCatalog).not.toHaveBeenCalled();
  });
});
