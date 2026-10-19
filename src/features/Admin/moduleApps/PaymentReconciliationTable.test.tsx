import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PaymentReconciliationTable from './PaymentReconciliationTable';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

describe('PaymentReconciliationTable', () => {
  it('renders linked operational identifiers without raw payment metadata', () => {
    render(
      <PaymentReconciliationTable
        items={[
          {
            appId: 'app-1',
            appName: 'Commerce App',
            auditEventIds: ['audit-1'],
            currency: 'CNY',
            discrepancyIds: ['discrepancy-1'],
            id: 'attempt-1',
            licenseIds: ['license-1'],
            latestAppRuntimeInvocationId: 'run-1',
            method: 'wechat_pay',
            orderId: 'order-1',
            orderStatus: 'paid',
            outTradeNo: 'out-1',
            paymentEventIds: ['event-1'],
            paymentStatus: 'paid',
            payoutBatchIds: ['payout-1'],
            provider: 'wechat_pay',
            providerTransactionId: 'wechat-transaction-1',
            refundIds: ['refund-1'],
            revenueEntryIds: ['revenue-1'],
            totalAmount: '88.00',
          },
        ]}
      />,
    );

    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('event-1')).toBeInTheDocument();
    expect(screen.getByText('payout-1')).toBeInTheDocument();
    expect(screen.getByText('run-1')).toBeInTheDocument();
    expect(screen.getAllByText('wechat_pay')).toHaveLength(2);
    expect(screen.getByText('wechat-transaction-1')).toBeInTheDocument();
    expect(screen.queryByText(/signature/i)).not.toBeInTheDocument();
  });

  it('renders permission denial and retries', () => {
    const onRetry = vi.fn();
    render(
      <PaymentReconciliationTable error={new Error('FORBIDDEN')} items={[]} onRetry={onRetry} />,
    );

    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('hides payment recovery actions for read-only users', () => {
    render(
      <PaymentReconciliationTable
        canWrite={false}
        items={[
          {
            appId: 'app-1',
            appName: 'Commerce App',
            auditEventIds: [],
            currency: 'CNY',
            discrepancyIds: ['discrepancy-1'],
            id: 'attempt-1',
            licenseIds: [],
            method: 'alipay',
            orderId: 'order-1',
            orderStatus: 'paid',
            outTradeNo: 'out-1',
            paymentEventIds: [],
            paymentStatus: 'paid',
            payoutBatchIds: [],
            provider: 'alipay',
            refundIds: [],
            revenueEntryIds: [],
            totalAmount: '88.00',
          },
        ]}
        onAcknowledge={vi.fn()}
        onRetryPayment={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /acknowledge|retry|refund|settle/i })).toBeNull();
  });

  it('renders only actions backed by row identifiers', () => {
    const onRetryPayment = vi.fn();
    render(
      <PaymentReconciliationTable
        canWrite
        items={[
          {
            appId: 'app-1',
            appName: 'Commerce App',
            auditEventIds: [],
            currency: 'CNY',
            discrepancyIds: ['discrepancy-1'],
            discrepancyStatus: 'open',
            id: 'attempt-1',
            licenseIds: [],
            method: 'alipay',
            orderId: 'order-1',
            orderStatus: 'paid',
            outTradeNo: 'out-1',
            paymentEventIds: [],
            paymentStatus: 'paid',
            payoutBatchIds: [],
            provider: 'alipay',
            refundIds: [],
            revenueEntryIds: [],
            totalAmount: '88.00',
          },
        ]}
        onAcknowledge={vi.fn()}
        onOpenRefund={vi.fn()}
        onRetryPayment={onRetryPayment}
      />,
    );

    expect(screen.getByRole('button', { name: 'Acknowledge discrepancy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refund payment' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry payment query' }));
    expect(onRetryPayment).toHaveBeenCalledWith('out-1', 'alipay');
    expect(screen.queryByRole('button', { name: 'Retry refund status' })).toBeNull();
  });
});
