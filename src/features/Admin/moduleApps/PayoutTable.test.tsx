import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PayoutTable from './PayoutTable';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

describe('PayoutTable', () => {
  it('renders payout, revenue, transaction, and audit links', () => {
    render(
      <PayoutTable
        items={[
          {
            auditEventIds: ['audit-1'],
            currency: 'CNY',
            id: 'payout-1',
            publisherId: 'publisher-1',
            publisherName: 'Verified Studio',
            recipientMask: 'ali***@example.com',
            revenueEntryIds: ['revenue-1'],
            status: 'paid',
            totalAmount: 80,
            transactionNo: 'alipay-txn-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('payout-1')).toBeInTheDocument();
    expect(screen.getByText('revenue-1')).toBeInTheDocument();
    expect(screen.getByText('alipay-txn-1')).toBeInTheDocument();
    expect(screen.getByText('audit-1')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(<PayoutTable loading items={[]} />);
    expect(screen.getByLabelText('Loading payouts')).toBeInTheDocument();
  });

  it('hides payout lifecycle controls for read-only users', () => {
    render(
      <PayoutTable
        canWrite={false}
        items={[
          {
            auditEventIds: [],
            currency: 'CNY',
            id: 'payout-1',
            publisherId: 'publisher-1',
            publisherName: 'Verified Studio',
            recipientMask: 'ali***@example.com',
            revenueEntryIds: ['revenue-1'],
            status: 'failed',
            totalAmount: 80,
          },
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /payout|manual|transition|record/i })).toBeNull();
  });

  it('renders lifecycle actions with localized labels', () => {
    render(
      <PayoutTable
        canWrite
        labels={{ action: '操作', manage: '管理结算', payout: '结算批次' }}
        items={[
          {
            auditEventIds: [],
            currency: 'CNY',
            id: 'payout-1',
            publisherId: 'publisher-1',
            publisherName: 'Verified Studio',
            recipientMask: 'ali***@example.com',
            revenueEntryIds: ['revenue-1'],
            status: 'failed',
            totalAmount: 80,
          },
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '管理结算 payout-1' })).toBeInTheDocument();
  });
});
