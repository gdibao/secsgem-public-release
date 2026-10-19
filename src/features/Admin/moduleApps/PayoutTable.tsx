'use client';

import type { ModuleAppPayoutStatus } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Tag, Typography } from 'antd';
import { memo } from 'react';

import InlineTable from '@/components/InlineTable';

import { AdminTableState } from './AdminTableState';
import CursorPager from './CursorPager';

const { Text } = Typography;

export type ModuleAppPayoutRow = {
  auditEventIds: string[];
  createdAt?: Date | string;
  currency: string;
  id: string;
  publisherId: string;
  publisherName: string;
  recipientMask?: null | string;
  revenueEntryIds: string[];
  status: ModuleAppPayoutStatus;
  totalAmount: number;
  transactionNo?: null | string;
};

export type PayoutTableLabels = Partial<{
  action: string;
  alipayTransaction: string;
  amount: string;
  audit: string;
  empty: string;
  loading: string;
  manage: string;
  next: string;
  payout: string;
  previous: string;
  publisher: string;
  recipient: string;
  retry: string;
  revenue: string;
  status: string;
}>;

type PayoutTableProps = {
  canWrite?: boolean;
  error?: unknown;
  hasNext?: boolean;
  hasPrevious?: boolean;
  items?: ModuleAppPayoutRow[];
  labels?: PayoutTableLabels;
  loading?: boolean;
  onAction?: (row: ModuleAppPayoutRow) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onRetry?: () => void;
  statusLabels?: Record<string, string>;
};

const defaultLabels = {
  action: 'Actions',
  alipayTransaction: 'Alipay transaction',
  amount: 'Amount',
  audit: 'Audit',
  empty: 'No payouts',
  loading: 'Loading payouts',
  manage: 'Manage payout',
  next: 'Next page',
  payout: 'Payout',
  previous: 'Previous page',
  publisher: 'Publisher',
  recipient: 'Recipient',
  retry: 'Retry',
  revenue: 'Revenue',
  status: 'Status',
};

const CodeList = ({ values }: { values: string[] }) =>
  values.length ? (
    <Flexbox gap={2} style={{ maxWidth: 220 }}>
      {values.map((value) => (
        <Text code copyable key={value} style={{ overflowWrap: 'anywhere' }}>
          {value}
        </Text>
      ))}
    </Flexbox>
  ) : (
    '-'
  );

const PayoutTable = memo<PayoutTableProps>(
  ({
    canWrite = false,
    error,
    hasNext,
    hasPrevious,
    items = [],
    labels,
    loading,
    onAction,
    onNext,
    onPrevious,
    onRetry,
    statusLabels,
  }) => {
    const copy = { ...defaultLabels, ...labels };
    const hasPager =
      hasNext !== undefined || hasPrevious !== undefined || Boolean(onNext) || Boolean(onPrevious);
    const columns = [
      {
        dataIndex: 'id',
        key: 'id',
        render: (value: string) => <CodeList values={[value]} />,
        title: copy.payout,
      },
      { dataIndex: 'publisherName', key: 'publisherName', title: copy.publisher },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: ModuleAppPayoutStatus) => (
          <Tag color={value === 'paid' ? 'green' : value === 'failed' ? 'red' : 'gold'}>
            {statusLabels?.[value] ?? value}
          </Tag>
        ),
        title: copy.status,
      },
      {
        key: 'amount',
        render: (_: unknown, row: ModuleAppPayoutRow) =>
          `${row.currency} ${Number(row.totalAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
        title: copy.amount,
      },
      { dataIndex: 'recipientMask', key: 'recipientMask', title: copy.recipient },
      {
        dataIndex: 'transactionNo',
        key: 'transactionNo',
        render: (value?: null | string) => <CodeList values={value ? [value] : []} />,
        title: copy.alipayTransaction,
      },
      {
        key: 'revenueEntryIds',
        render: (_: unknown, row: ModuleAppPayoutRow) => <CodeList values={row.revenueEntryIds} />,
        title: copy.revenue,
      },
      {
        key: 'auditEventIds',
        render: (_: unknown, row: ModuleAppPayoutRow) => <CodeList values={row.auditEventIds} />,
        title: copy.audit,
      },
      ...(canWrite && onAction
        ? [
            {
              key: 'actions',
              render: (_: unknown, row: ModuleAppPayoutRow) => (
                <Button aria-label={`${copy.manage} ${row.id}`} onClick={() => onAction(row)}>
                  {copy.manage}
                </Button>
              ),
              title: copy.action,
            },
          ]
        : []),
    ];
    return (
      <Flexbox gap={10}>
        <AdminTableState
          emptyLabel={copy.empty}
          error={error}
          loading={loading}
          loadingLabel={copy.loading}
          retryLabel={copy.retry}
          onRetry={onRetry}
        >
          {items.length ? (
            <InlineTable columns={columns as any} dataSource={items} rowKey="id" />
          ) : null}
        </AdminTableState>
        {hasPager ? (
          <CursorPager
            hasNext={hasNext}
            hasPrevious={hasPrevious}
            nextLabel={copy.next}
            previousLabel={copy.previous}
            onNext={onNext}
            onPrevious={onPrevious}
          />
        ) : null}
      </Flexbox>
    );
  },
);

PayoutTable.displayName = 'PayoutTable';

export default PayoutTable;
