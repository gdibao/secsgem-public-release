import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModulePaymentsPage from './ModulePaymentsPage';

const moduleApps = vi.hoisted(() => ({
  acknowledgePaymentDiscrepancy: vi.fn(),
  exportPaymentReconciliation: vi.fn(),
  listPaymentDiagnostics: vi.fn(),
  reconcilePendingPayments: vi.fn(),
  refundOrder: vi.fn(),
  refundPaymentOrder: vi.fn(),
  resolvePaymentRefund: vi.fn(),
  retryPaymentQuery: vi.fn(),
  retryRefundStatus: vi.fn(),
  settleOrder: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const state = vi.hoisted(() => ({
  data: { items: [], nextCursor: null } as { items: any[]; nextCursor: null | string },
  error: undefined as Error | undefined,
}));

vi.mock('@lobechat/types', () => ({
  ADMIN_CAPABILITIES: { financeWrite: 'finance.write' },
  hasAdminCapability: () => true,
}));
vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({ user: {} }) }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (store: any) => store.user },
}));
vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: (_key: unknown, fetcher: () => Promise<unknown>) => {
    void fetcher();
    return { data: state.data, error: state.error, isLoading: false };
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
  Modal: (props: any) =>
    props.open ? (
      <div>
        {props.children}
        <button disabled={props.okButtonProps?.disabled} type="button" onClick={props.onOk}>
          {props.okText}
        </button>
      </div>
    ) : null,
  Select: ({ options, onChange, ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  TextArea: (props: any) => <textarea {...props} />,
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModulePaymentsPage', () => {
  beforeEach(() => {
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('restores payment filters from the URL and mounts only payment diagnostics', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/finance/payments?paymentStatus=failed&refundStatus=requested&discrepancyStatus=open&appId=app-1&orderId=order-1&cursor=cursor-1',
        ]}
      >
        <ModulePaymentsPage canWrite={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listPaymentDiagnostics).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: 'cursor-1',
        discrepancyStatus: 'open',
        limit: 25,
        orderId: 'order-1',
        paymentStatus: 'failed',
        refundStatus: 'requested',
      }),
    );
    expect(screen.getByTestId('module-payments-page')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'moduleApps.admin.payments.reconcilePending' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'moduleApps.admin.payments.exportDiscrepancies' }),
    ).toBeInTheDocument();
  });

  it('hides the duplicate page heading when embedded in the payment center', () => {
    render(
      <MemoryRouter initialEntries={['/admin/payments?tab=moduleApps']}>
        <ModulePaymentsPage embedded canWrite={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'moduleApps.admin.payments.title' })).toBeNull();
  });

  it('preserves refund input after a server failure and never persists it locally', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    state.data = {
      items: [
        {
          appId: 'app-1',
          appName: 'Commerce App',
          auditEventIds: [],
          currency: 'CNY',
          discrepancyIds: [],
          id: 'attempt-1',
          licenseIds: [],
          method: 'zpay_alipay',
          orderId: '00000000-0000-4000-8000-000000000001',
          orderStatus: 'paid',
          outTradeNo: 'trade-1',
          paymentEventIds: [],
          paymentStatus: 'paid',
          payoutBatchIds: [],
          provider: 'zpay',
          refundIds: [],
          revenueEntryIds: [],
          totalAmount: '88.00',
        },
      ],
      nextCursor: null,
    };
    moduleApps.refundPaymentOrder.mockRejectedValueOnce(new Error('provider unavailable'));

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/finance/payments']}>
        <ModulePaymentsPage canWrite />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payments.actions.refund' }),
    );
    const reason = screen.getByLabelText('moduleApps.admin.payments.form.reason');
    fireEvent.change(reason, { target: { value: 'Duplicate payment' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payments.confirm.refund' }),
    );

    await waitFor(() =>
      expect(moduleApps.refundPaymentOrder).toHaveBeenCalledWith({
        orderId: '00000000-0000-4000-8000-000000000001',
        reason: 'Duplicate payment',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('provider unavailable');
    expect(reason).toHaveValue('Duplicate payment');
    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });

  it('requires evidence before manually resolving a pending ZPay refund', async () => {
    const orderId = '00000000-0000-4000-8000-000000000001';
    state.data = {
      items: [
        {
          appId: 'app-1',
          appName: 'Commerce App',
          auditEventIds: [],
          currency: 'CNY',
          discrepancyIds: [],
          id: 'attempt-1',
          licenseIds: ['license-1'],
          method: 'zpay_alipay',
          orderId,
          orderStatus: 'paid',
          outTradeNo: 'trade-1',
          paymentEventIds: [],
          paymentStatus: 'paid',
          payoutBatchIds: [],
          provider: 'zpay',
          refundIds: ['refund-1'],
          refundStatus: 'requested',
          revenueEntryIds: ['revenue-1'],
          totalAmount: '88.00',
        },
      ],
      nextCursor: null,
    };
    moduleApps.resolvePaymentRefund.mockResolvedValue({ status: 'refunded' });

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/finance/payments']}>
        <ModulePaymentsPage canWrite />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payments.actions.resolveRefund' }),
    );
    const confirm = screen.getByRole('button', {
      name: 'moduleApps.admin.payments.manualResolution.confirm',
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payments.manualResolution.note'), {
      target: { value: 'merchant portal shows refund completed' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payments.manualResolution.outcome'), {
      target: { value: 'succeeded' },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(moduleApps.resolvePaymentRefund).toHaveBeenCalledWith({
        note: 'merchant portal shows refund completed',
        orderId,
        resolution: 'succeeded',
      }),
    );
  });
});
