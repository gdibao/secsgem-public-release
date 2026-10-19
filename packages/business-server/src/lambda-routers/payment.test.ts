import { Plans } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { paymentRouter } from './payment';

const {
  bindOnlineTopUpPayment,
  bindSubscriptionPayment,
  createOnlineTopUpOrder,
  createSubscriptionPaymentOrder,
  createOperationalPaymentConfig,
  createPaymentAdapter,
  getServerPaymentConfig,
  reconcilePayment,
  reconcileSubscriptionPayment,
  resolvePaymentMethod,
  storeOnlineTopUpCheckout,
  storeSubscriptionPaymentCheckout,
} = vi.hoisted(() => ({
  bindOnlineTopUpPayment: vi.fn(),
  bindSubscriptionPayment: vi.fn(),
  createOnlineTopUpOrder: vi.fn(),
  createSubscriptionPaymentOrder: vi.fn(),
  createOperationalPaymentConfig: vi.fn(),
  createPaymentAdapter: vi.fn(),
  getServerPaymentConfig: vi.fn(),
  reconcilePayment: vi.fn(),
  reconcileSubscriptionPayment: vi.fn(),
  resolvePaymentMethod: vi.fn(),
  storeOnlineTopUpCheckout: vi.fn(),
  storeSubscriptionPaymentCheckout: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: class {
    bindOnlineTopUpPayment = bindOnlineTopUpPayment;
    bindSubscriptionPayment = bindSubscriptionPayment;
    createOnlineTopUpOrder = createOnlineTopUpOrder;
    createSubscriptionPaymentOrder = createSubscriptionPaymentOrder;
    storeOnlineTopUpCheckout = storeOnlineTopUpCheckout;
    storeSubscriptionPaymentCheckout = storeSubscriptionPaymentCheckout;
  },
}));

vi.mock('@/server/services/payments/config', () => ({
  buildPaymentCallbackUrl: vi.fn(() => 'https://app.example.com/api/webhooks/payments/wechat_pay'),
  buildPaymentReturnUrl: vi.fn(() => 'https://app.example.com/settings/billing'),
  createOperationalPaymentConfig,
  getServerPaymentConfig,
  listCheckoutPaymentMethods: vi.fn(() => []),
  resolvePaymentMethod,
}));

vi.mock('@/server/services/payments/factory', () => ({ createPaymentAdapter }));

vi.mock('@/server/services/payments/subscriptionPayment', () => ({
  SubscriptionPaymentService: class {
    constructor(
      _db: unknown,
      private readonly resolveAdapter: (provider: string, method: string) => unknown,
    ) {}

    reconcilePayment = async (input: unknown) => {
      await this.resolveAdapter('wechat_pay', 'wechat_pay');
      return reconcileSubscriptionPayment(input);
    };
  },
}));

vi.mock('@/server/services/payments/topUpPayment', () => ({
  TopUpPaymentService: class {
    constructor(
      _db: unknown,
      private readonly resolveAdapter: (provider: string, method: string) => unknown,
    ) {}

    reconcilePayment = async (input: unknown) => {
      await this.resolveAdapter('wechat_pay', 'wechat_pay');
      return reconcilePayment(input);
    };
  },
}));

const orderId = '00000000-0000-4000-8000-000000000001';
const idempotencyKey = '00000000-0000-4000-8000-000000000002';
const checkout = { type: 'qrcode' as const, url: 'weixin://wxpay/bizpayurl?pr=test' };

describe('paymentRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as any);
    getServerPaymentConfig.mockResolvedValue({
      enabled: true,
      publicBaseUrl: 'https://app.example.com',
      subscriptionEnabled: true,
      topUpEnabled: true,
    });
    createOperationalPaymentConfig.mockImplementation((config) => ({
      ...config,
      enabled: true,
      subscriptionEnabled: true,
      topUpEnabled: true,
      wechat: { enabled: true },
    }));
    resolvePaymentMethod.mockReturnValue({ id: 'wechat_pay', provider: 'wechat_pay' });
    createOnlineTopUpOrder.mockResolvedValue({
      created: true,
      order: {
        amount: 19.9,
        checkout: null,
        currency: 'CNY',
        externalOrderId: null,
        id: orderId,
      },
    });
    bindOnlineTopUpPayment.mockResolvedValue({
      claimed: true,
      order: {
        amount: 19.9,
        checkout: null,
        currency: 'CNY',
        externalOrderId: 'top-up-trade-no',
        id: orderId,
      },
    });
    storeOnlineTopUpCheckout.mockResolvedValue({ checkout });
    createSubscriptionPaymentOrder.mockResolvedValue({
      created: true,
      order: {
        amount: 68,
        checkout: null,
        currency: 'CNY',
        cycle: 'monthly',
        expiresAt: new Date('2026-07-28T00:30:00.000Z'),
        externalOrderId: null,
        id: orderId,
        method: 'wechat_pay',
        provider: 'wechat_pay',
        snapshot: { displayName: 'Starter' },
      },
    });
    bindSubscriptionPayment.mockResolvedValue({
      claimed: true,
      order: {
        checkout: null,
        externalOrderId: 'subscription-trade-no',
        id: orderId,
        method: 'wechat_pay',
        provider: 'wechat_pay',
      },
    });
    storeSubscriptionPaymentCheckout.mockResolvedValue({ checkout });
    createPaymentAdapter.mockReturnValue({
      create: vi.fn().mockResolvedValue({
        checkout,
        method: 'wechat_pay',
        outTradeNo: 'top-up-trade-no',
        provider: 'wechat_pay',
      }),
      createOutTradeNo: vi.fn(() => 'top-up-trade-no'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
    });
  });

  it('rejects custom credits for online payment instead of creating an unusable USD order', async () => {
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createPaymentOrder({
        credits: 50_000_000,
        idempotencyKey,
        method: 'wechat_pay',
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createOnlineTopUpOrder).not.toHaveBeenCalled();
  });

  it('requires a client idempotency key before creating an order', async () => {
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createPaymentOrder({ method: 'wechat_pay', packageId: 'online-cny' } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createOnlineTopUpOrder).not.toHaveBeenCalled();
  });

  it('validates the payment adapter before persisting a top-up order', async () => {
    createPaymentAdapter.mockImplementation(() => {
      throw new Error('WECHAT_PAY_API_V3_KEY_INVALID');
    });
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createPaymentOrder({ idempotencyKey, method: 'wechat_pay', packageId: 'online-cny' }),
    ).rejects.toMatchObject({ message: 'WECHAT_PAY_API_V3_KEY_INVALID' });
    expect(createOnlineTopUpOrder).not.toHaveBeenCalled();
  });

  it('returns the persisted checkout without creating another provider order', async () => {
    createOnlineTopUpOrder.mockResolvedValue({
      created: false,
      order: {
        amount: 19.9,
        checkout,
        currency: 'CNY',
        externalOrderId: 'top-up-trade-no',
        id: orderId,
      },
    });
    const adapter = createPaymentAdapter();
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createPaymentOrder({ idempotencyKey, method: 'wechat_pay', packageId: 'online-cny' }),
    ).resolves.toEqual({
      checkout,
      method: 'wechat_pay',
      orderId,
      outTradeNo: 'top-up-trade-no',
      provider: 'wechat_pay',
    });
    expect(adapter.create).not.toHaveBeenCalled();
    expect(bindOnlineTopUpPayment).not.toHaveBeenCalled();
  });

  it('does not repeat a claimed WeChat create request before checkout is persisted', async () => {
    createOnlineTopUpOrder.mockResolvedValue({
      created: false,
      order: {
        amount: 19.9,
        checkout: null,
        currency: 'CNY',
        externalOrderId: 'top-up-trade-no',
        id: orderId,
      },
    });
    bindOnlineTopUpPayment.mockResolvedValue({
      claimed: false,
      order: {
        amount: 19.9,
        checkout: null,
        currency: 'CNY',
        externalOrderId: 'top-up-trade-no',
        id: orderId,
      },
    });
    const adapter = createPaymentAdapter();
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createPaymentOrder({ idempotencyKey, method: 'wechat_pay', packageId: 'online-cny' }),
    ).rejects.toMatchObject({ message: 'TOP_UP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED' });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it('recovers an existing order with operational provider access after checkout is disabled', async () => {
    getServerPaymentConfig.mockResolvedValue({
      enabled: false,
      publicBaseUrl: 'https://app.example.com',
      topUpEnabled: false,
      wechat: { enabled: false },
    });
    reconcilePayment.mockResolvedValue({
      checkout: null,
      orderId,
      providerStatus: 'pending',
      recoveryRequired: true,
      status: 'pending',
    });
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(caller.recoverPaymentOrder({ idempotencyKey })).resolves.toMatchObject({
      orderId,
      recoveryRequired: true,
      status: 'pending',
    });
    expect(createOperationalPaymentConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, topUpEnabled: false }),
    );
    expect(createPaymentAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, topUpEnabled: true }),
      'wechat_pay',
    );
    expect(reconcilePayment).toHaveBeenCalledWith({ idempotencyKey, userId: 'user-1' });
  });

  it('creates and persists a subscription checkout', async () => {
    createPaymentAdapter.mockReturnValue({
      create: vi.fn().mockResolvedValue({
        checkout,
        method: 'wechat_pay',
        outTradeNo: 'subscription-trade-no',
        provider: 'wechat_pay',
      }),
      createOutTradeNo: vi.fn(() => 'subscription-trade-no'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
    });
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(
      caller.createSubscriptionPaymentOrder({
        cycle: 'monthly',
        idempotencyKey,
        method: 'wechat_pay',
        plan: Plans.Starter,
      }),
    ).resolves.toEqual({
      checkout,
      method: 'wechat_pay',
      orderId,
      outTradeNo: 'subscription-trade-no',
      provider: 'wechat_pay',
    });
    expect(createSubscriptionPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ cycle: 'monthly', plan: Plans.Starter }),
    );
    expect(storeSubscriptionPaymentCheckout).toHaveBeenCalledWith({ checkout, orderId });
  });

  it('recovers a subscription order with operational provider access', async () => {
    getServerPaymentConfig.mockResolvedValue({
      enabled: false,
      publicBaseUrl: 'https://app.example.com',
      subscriptionEnabled: false,
      topUpEnabled: false,
      wechat: { enabled: false },
    });
    reconcileSubscriptionPayment.mockResolvedValue({
      checkout: null,
      orderId,
      providerStatus: 'pending',
      recoveryRequired: true,
      status: 'pending',
    });
    const caller = paymentRouter.createCaller({ userId: 'user-1' } as any);

    await expect(caller.recoverSubscriptionPaymentOrder({ idempotencyKey })).resolves.toMatchObject(
      { orderId, recoveryRequired: true },
    );
    expect(reconcileSubscriptionPayment).toHaveBeenCalledWith({
      idempotencyKey,
      userId: 'user-1',
    });
  });
});
