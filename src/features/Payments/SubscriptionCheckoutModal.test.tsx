import { Plans } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commercialService } from '@/services/commercial';

import { SubscriptionCheckoutModal } from './SubscriptionCheckoutModal';

const checkout = vi.hoisted(() => ({ submit: vi.fn() }));
const paymentIntent = vi.hoisted(() => ({
  clear: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
}));
const swrState = vi.hoisted(() => ({ paymentStatus: 'expired' }));
const swrMutate = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/commercialRefresh', () => ({
  refreshCommercialEntitlementState: vi.fn(),
}));
vi.mock('@/services/commercial', () => ({
  commercialService: {
    createSubscriptionPaymentOrder: vi.fn(),
    getSubscriptionPaymentMethods: vi.fn(),
    getSubscriptionPaymentStatus: vi.fn(),
    recoverSubscriptionPaymentOrder: vi.fn(),
  },
}));
vi.mock('./checkout', () => ({ submitPaymentCheckout: checkout.submit }));
vi.mock('./subscriptionIntent', () => ({
  clearSubscriptionPaymentIntent: paymentIntent.clear,
  getOrCreateSubscriptionPaymentIntent: paymentIntent.create,
  readSubscriptionPaymentIntent: paymentIntent.read,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('swr', () => ({
  default: (key: unknown) => {
    const name = Array.isArray(key) ? key[0] : undefined;
    if (name === 'payment.getSubscriptionPaymentMethods') {
      return {
        data: [{ id: 'alipay', label: 'Alipay', provider: 'alipay' }],
        isLoading: false,
      };
    }
    if (name === 'payment.getSubscriptionPaymentStatus') {
      return {
        data: {
          orderId: '00000000-0000-4000-8000-000000000033',
          status: swrState.paymentStatus,
        },
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  mutate: swrMutate,
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  Segmented: () => null,
}));
vi.mock('antd', () => ({
  Alert: ({ action, message }: { action?: ReactNode; message?: ReactNode }) => (
    <div role="alert">
      {message}
      {action}
    </div>
  ),
  QRCode: () => null,
  Typography: { Text: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
}));

describe('SubscriptionCheckoutModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.paymentStatus = 'expired';
    paymentIntent.read.mockReturnValue({
      cycle: 'yearly',
      idempotencyKey: '00000000-0000-4000-8000-000000000031',
      method: 'alipay',
      plan: Plans.Starter,
    });
    paymentIntent.create.mockReturnValue({
      cycle: 'yearly',
      idempotencyKey: '00000000-0000-4000-8000-000000000032',
      method: 'alipay',
      plan: Plans.Starter,
    });
    vi.mocked(commercialService.recoverSubscriptionPaymentOrder).mockResolvedValue({
      checkout: { type: 'qrcode', url: 'https://pay.example.com/qr/old' },
      orderId: '00000000-0000-4000-8000-000000000033',
      providerStatus: 'pending',
      recoveryRequired: false,
      status: 'expired',
    });
    vi.mocked(commercialService.createSubscriptionPaymentOrder).mockResolvedValue({
      checkout: { type: 'qrcode', url: 'https://pay.example.com/qr/new' },
      method: 'alipay',
      orderId: '00000000-0000-4000-8000-000000000034',
      outTradeNo: 'subscription-out-trade-no-new',
      provider: 'alipay',
    });
    checkout.submit.mockReturnValue({ type: 'qrcode', url: 'https://pay.example.com/qr/new' });
  });

  it('rotates the idempotency key before retrying a terminal order', async () => {
    render(
      <SubscriptionCheckoutModal
        target={{
          cycle: 'yearly',
          displayName: 'Starter',
          plan: Plans.Starter,
          priceLabel: 'CNY 680/year',
        }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(paymentIntent.clear).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000031'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'plans.payment.pay' }));

    await waitFor(() =>
      expect(commercialService.createSubscriptionPaymentOrder).toHaveBeenCalledWith({
        cycle: 'yearly',
        idempotencyKey: '00000000-0000-4000-8000-000000000032',
        method: 'alipay',
        plan: Plans.Starter,
      }),
    );
  });
});
