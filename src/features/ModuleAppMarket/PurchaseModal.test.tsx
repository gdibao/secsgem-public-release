import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moduleAppService } from '@/services/moduleApp';

import PurchaseModal, { getPaymentStatusRefreshInterval } from './PurchaseModal';

const mobileState = vi.hoisted(() => ({ isMobile: false }));
const floatingSheetProps = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mobileState.isMobile,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Button: ({
      children,
      disabled,
      loading,
      onClick,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      loading?: boolean;
      onClick?: () => void;
    }) => (
      <button aria-busy={loading} disabled={disabled} type="button" onClick={onClick}>
        {children}
      </button>
    ),
    FloatingSheet: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      floatingSheetProps(props);
      return props.open ? (
        <section data-testid="module-app-purchase-sheet">
          <header>
            {props.title as ReactNode}
            {props.headerActions as ReactNode}
          </header>
          {children}
        </section>
      ) : null;
    },
    Modal: ({
      children,
      open,
      title,
    }: {
      children?: ReactNode;
      open?: boolean;
      title?: ReactNode;
    }) =>
      open ? (
        <section aria-modal="true" role="dialog">
          <header>{title}</header>
          {children}
        </section>
      ) : null,
    Segmented: ({
      disabled,
      onChange,
      options = [],
      value,
    }: {
      disabled?: boolean;
      onChange?: (value: string) => void;
      options?: { label: ReactNode; value: string }[];
      value?: string;
    }) => (
      <div>
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            disabled={disabled}
            key={option.value}
            type="button"
            onClick={() => onChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
  };
});

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: {
    getPaymentMethods: vi
      .fn()
      .mockResolvedValue([{ id: 'alipay', label: 'Alipay', provider: 'alipay' }]),
    getPaymentStatus: vi.fn().mockResolvedValue({
      method: 'alipay',
      paymentStatus: 'created',
      provider: 'alipay',
      status: 'pending',
    }),
    quoteProduct: vi.fn().mockResolvedValue({ currency: 'CNY', price: 1200 }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}:${values?.amount ?? values?.percent ?? values?.date ?? ''}`,
  }),
}));

const catalog = [
  {
    amount: 1200,
    appId: 'app-1',
    billingPeriod: 'monthly',
    currency: 'CNY',
    licenseScope: 'personal',
    productId: '00000000-0000-4000-8000-000000000001',
    productType: 'subscription',
  },
];

const paymentResult = {
  checkout: { type: 'qrcode' as const, url: 'weixin://wxpay/test' },
  method: 'alipay' as const,
  outTradeNo: 'out-order-1',
  provider: 'alipay' as const,
};

describe('PurchaseModal', () => {
  beforeEach(() => {
    mobileState.isMobile = false;
    floatingSheetProps.mockReset();
  });

  it('keeps the desktop purchase flow in a modal', () => {
    render(
      <PurchaseModal
        open
        catalog={catalog}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(floatingSheetProps).not.toHaveBeenCalled();
  });

  it('stops status polling after the provider reports failure', () => {
    expect(
      getPaymentStatusRefreshInterval({
        method: 'alipay',
        paymentStatus: 'failed',
        provider: 'alipay',
        status: 'pending',
      }),
    ).toBe(0);
    expect(
      getPaymentStatusRefreshInterval({
        method: 'alipay',
        paymentStatus: 'pending',
        provider: 'alipay',
        status: 'pending',
      }),
    ).toBe(3000);
  });

  it('uses a scrollable mobile FloatingSheet with a named close action', () => {
    mobileState.isMobile = true;
    const onClose = vi.fn();

    render(
      <PurchaseModal
        open
        catalog={catalog}
        onCancelOrder={vi.fn()}
        onClose={onClose}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByTestId('module-app-purchase-sheet')).toBeInTheDocument();
    expect(floatingSheetProps).toHaveBeenCalledWith(
      expect.objectContaining({
        dismissible: true,
        maxHeight: 720,
        minHeight: 320,
        mode: 'overlay',
        open: true,
        restingHeight: 520,
        snapPoints: [520, 720],
      }),
    );
    expect(screen.getByTestId('module-app-purchase-content')).toHaveStyle({
      overflowY: 'auto',
    });
    fireEvent.click(screen.getByRole('button', { name: /moduleApps\.purchase\.close/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a pending order instead of claiming purchase success', () => {
    render(
      <PurchaseModal
        open
        catalog={catalog}
        order={{ id: 'order-1', status: 'pending' }}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByText('moduleApps.purchase.pending:')).toBeInTheDocument();
    expect(screen.queryByText('moduleApps.purchase.success:')).not.toBeInTheDocument();
  });

  it('shows the provider failure state for a pending order', async () => {
    vi.mocked(moduleAppService.getPaymentStatus).mockResolvedValueOnce({
      method: 'alipay',
      paymentStatus: 'failed',
      provider: 'alipay',
      status: 'pending',
    });

    render(
      <PurchaseModal
        open
        catalog={catalog}
        order={{ id: 'order-provider-failed', status: 'pending' }}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(await screen.findByText('moduleApps.purchase.paymentFailed:')).toBeInTheDocument();
  });

  it('does not allow a duplicate order while paid access is activating', () => {
    render(
      <PurchaseModal
        open
        catalog={catalog}
        order={{ id: 'order-paid', status: 'paid' }}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByText('moduleApps.purchase.paymentConfirmed:')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /moduleApps\.purchase\.createOrder/ }),
    ).not.toBeInTheDocument();
  });

  it('shows an unavailable state when the selected scope has no products', () => {
    render(
      <PurchaseModal
        open
        catalog={[]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByText('moduleApps.purchase.noProducts:')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /moduleApps\.purchase\.createOrder/ }),
    ).not.toBeInTheDocument();
  });

  it('creates an order with the selected server catalog product', async () => {
    mobileState.isMobile = true;
    const onCreateOrder = vi.fn().mockResolvedValue({ id: 'order-1' });
    const onCreatePayment = vi.fn().mockResolvedValue(paymentResult);
    render(
      <PurchaseModal
        open
        catalog={catalog}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
        onCreatePayment={onCreatePayment}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /moduleApps\.purchase\.payNow/ }));
    await waitFor(() =>
      expect(onCreateOrder).toHaveBeenCalledWith({
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        productId: catalog[0].productId,
      }),
    );
    expect(onCreatePayment).toHaveBeenCalledWith({
      method: 'alipay',
      orderId: 'order-1',
    });
  });

  it('reuses the same order idempotency key after an uncertain request failure', async () => {
    const onCreateOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ id: 'order-recovered' });
    render(
      <PurchaseModal
        open
        catalog={catalog}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
        onCreatePayment={vi.fn().mockResolvedValue(paymentResult)}
      />,
    );

    const pay = await screen.findByRole('button', { name: /moduleApps\.purchase\.payNow/ });
    fireEvent.click(pay);
    await waitFor(() => expect(onCreateOrder).toHaveBeenCalledTimes(1));
    expect(onCreateOrder.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    fireEvent.click(pay);
    await waitFor(() => expect(onCreateOrder).toHaveBeenCalledTimes(2));

    expect(onCreateOrder.mock.calls[1][0].idempotencyKey).toBe(
      onCreateOrder.mock.calls[0][0].idempotencyKey,
    );
  });

  it('installs a free personal product without creating a payment order', async () => {
    const onInstall = vi.fn().mockResolvedValue(undefined);
    const onCreateOrder = vi.fn();
    render(
      <PurchaseModal
        open
        catalog={[{ ...catalog[0], amount: 0, productType: 'free' }]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
        onCreatePayment={vi.fn().mockResolvedValue(paymentResult)}
        onInstall={onInstall}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /moduleApps\.purchase\.install/ }));
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith({ appId: 'app-1' }));
    expect(onCreateOrder).not.toHaveBeenCalled();
  });

  it('installs a free workspace product in the selected workspace', async () => {
    const onInstall = vi.fn().mockResolvedValue(undefined);
    const onCreateOrder = vi.fn();
    render(
      <PurchaseModal
        open
        workspaceId="workspace-1"
        catalog={[
          {
            ...catalog[0],
            amount: 0,
            licenseScope: 'workspace',
            productType: 'free',
          },
        ]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
        onInstall={onInstall}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /moduleApps\.purchase\.install/ }));
    await waitFor(() =>
      expect(onInstall).toHaveBeenCalledWith({ appId: 'app-1', workspaceId: 'workspace-1' }),
    );
    expect(onCreateOrder).not.toHaveBeenCalled();
  });

  it('creates a payment order for a zero-price non-free product', async () => {
    const onCreateOrder = vi.fn().mockResolvedValue({ id: 'order-zero' });
    const onCreatePayment = vi.fn().mockResolvedValue(paymentResult);
    const onInstall = vi.fn();
    render(
      <PurchaseModal
        open
        catalog={[{ ...catalog[0], amount: 0, productType: 'one_time' }]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
        onCreatePayment={onCreatePayment}
        onInstall={onInstall}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /moduleApps\.purchase\.payNow/ }));
    await waitFor(() => expect(onCreateOrder).toHaveBeenCalled());
    expect(onCreatePayment).toHaveBeenCalledWith({
      method: 'alipay',
      orderId: 'order-zero',
    });
    expect(onInstall).not.toHaveBeenCalled();
  });

  it('requires a workspace context for team products', async () => {
    render(
      <PurchaseModal
        open
        catalog={[
          {
            ...catalog[0],
            licenseScope: 'workspace',
            productId: '00000000-0000-4000-8000-000000000002',
          },
        ]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={vi.fn()}
      />,
    );

    expect(screen.getByText('moduleApps.purchase.scope.workspace:')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.purchase.workspaceRequired:')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /moduleApps\.purchase\.payNow/ }),
    ).toBeDisabled();
  });

  it('shows immutable promotion and refund snapshots and creates a scoped order', async () => {
    const onCreateOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <PurchaseModal
        open
        order={{ id: 'order-refunded', status: 'refunded' }}
        workspaceId="workspace-1"
        catalog={[
          {
            ...catalog[0],
            licenseScope: 'workspace',
            productId: '00000000-0000-4000-8000-000000000002',
            promotion: {
              discountAmount: 120,
              discountPercent: 10,
              title: 'Launch offer',
              validUntil: '2026-08-01T00:00:00.000Z',
            },
          },
        ]}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
        onCreateOrder={onCreateOrder}
      />,
    );

    expect(screen.getByText('moduleApps.purchase.refunded:')).toBeInTheDocument();
    expect(screen.getByText('Launch offer')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.purchase.discountAmount:120')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.purchase.discountPercent:10')).toBeInTheDocument();
    expect(
      screen.getByText('moduleApps.purchase.validUntil:2026-08-01T00:00:00.000Z'),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /moduleApps\.purchase\.payNow/ }));
    await waitFor(() =>
      expect(onCreateOrder).toHaveBeenCalledWith({
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        productId: '00000000-0000-4000-8000-000000000002',
        workspaceId: 'workspace-1',
      }),
    );
  });
});
