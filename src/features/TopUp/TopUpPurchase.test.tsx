import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commercialService } from '@/services/commercial';

import { TopUpPurchase } from './TopUpPurchase';

const checkout = vi.hoisted(() => ({ submit: vi.fn() }));
const paymentIntent = vi.hoisted(() => ({
  clear: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
}));
const swrState = vi.hoisted(() => ({ paymentStatus: 'pending' }));
const translate = (key: string) => key;

vi.mock('@/business/client/commercialRefresh', () => ({
  refreshCommercialEntitlementState: vi.fn(),
}));
vi.mock('@/features/Payments/checkout', () => ({ submitPaymentCheckout: checkout.submit }));
vi.mock('@/services/commercial', () => ({
  commercialService: {
    createPaymentOrder: vi.fn(),
    getPaymentMethods: vi.fn(),
    getPaymentStatus: vi.fn(),
    getTopUpPackages: vi.fn(),
    recoverPaymentOrder: vi.fn(),
  },
}));
vi.mock('./paymentIntent', () => ({
  clearTopUpPaymentIntent: paymentIntent.clear,
  getOrCreateTopUpPaymentIntent: paymentIntent.create,
  readTopUpPaymentIntent: paymentIntent.read,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('swr', () => ({
  default: (key: unknown) => {
    const name = Array.isArray(key) ? key[0] : undefined;
    if (name === 'payment.getPaymentMethods') {
      return {
        data: [{ id: 'alipay', label: 'Alipay', provider: 'alipay' }],
        isLoading: false,
      };
    }
    if (name === 'commercial.listTopUpPackages') {
      return {
        data: [
          {
            amount: 19.9,
            credits: 199_000_000,
            currency: 'CNY',
            id: 'starter',
            validityMonths: 12,
          },
        ],
        isLoading: false,
      };
    }
    if (name === 'payment.getPaymentStatus') {
      return {
        data: {
          orderId: '00000000-0000-4000-8000-000000000002',
          status: swrState.paymentStatus,
        },
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  mutate: vi.fn(),
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
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
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Typography: {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  },
}));

describe('TopUpPurchase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.paymentStatus = 'pending';
    paymentIntent.read.mockReturnValue({
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      method: 'alipay',
      packageId: 'starter',
    });
    vi.mocked(commercialService.recoverPaymentOrder).mockResolvedValue({
      checkout: {
        fields: { sign: 'signed' },
        method: 'POST',
        type: 'form',
        url: 'https://openapi.alipay.com/gateway.do',
      },
      orderId: '00000000-0000-4000-8000-000000000002',
      providerStatus: 'pending',
      recoveryRequired: false,
      status: 'pending',
    });
  });

  it('uses the recoveryRequired contract when reconciling a restored intent', async () => {
    render(<TopUpPurchase />);

    await waitFor(() =>
      expect(commercialService.recoverPaymentOrder).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000001',
      ),
    );
    expect(checkout.submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'topup.online.queryStatus' })).toBeNull();
    expect(await screen.findByRole('alert')).toHaveTextContent('topup.online.pending');
  });

  it('clears an expired intent and allows a new payment order', async () => {
    swrState.paymentStatus = 'expired';
    paymentIntent.create.mockReturnValue({
      idempotencyKey: '00000000-0000-4000-8000-000000000003',
      method: 'alipay',
      packageId: 'starter',
    });
    vi.mocked(commercialService.createPaymentOrder).mockResolvedValue({
      checkout: { type: 'qrcode', url: 'https://pay.example.com/qr/new' },
      method: 'alipay',
      orderId: '00000000-0000-4000-8000-000000000004',
      outTradeNo: 'top-up-out-trade-no-new',
      provider: 'alipay',
    });
    checkout.submit.mockReturnValue({
      type: 'qrcode',
      url: 'https://pay.example.com/qr/new',
    });

    render(<TopUpPurchase />);

    await waitFor(() =>
      expect(paymentIntent.clear).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'topup.online.pay' }));

    await waitFor(() =>
      expect(commercialService.createPaymentOrder).toHaveBeenCalledWith({
        idempotencyKey: '00000000-0000-4000-8000-000000000003',
        method: 'alipay',
        packageId: 'starter',
      }),
    );
  });
});
