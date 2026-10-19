'use client';

import type { PaymentMethodId, PaymentProvider } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Tag, Typography } from 'antd';
import { memo } from 'react';

import InlineTable from '@/components/InlineTable';

import { AdminTableState } from './AdminTableState';
import CursorPager from './CursorPager';

const { Text } = Typography;

export type ModuleAppPaymentDiagnosticRow = {
  appId: string;
  appName: string;
  auditEventIds: string[];
  createdAt?: Date | string;
  currency: string;
  discrepancyIds: string[];
  discrepancyStatus?: null | string;
  id: string;
  licenseIds: string[];
  latestAppRuntimeInvocationId?: null | string;
  method: PaymentMethodId;
  orderId: string;
  orderStatus: string;
  outTradeNo: string;
  paymentEventIds: string[];
  paymentStatus: string;
  payoutBatchIds: string[];
  provider: PaymentProvider;
  providerTransactionId?: null | string;
  refundIds: string[];
  refundStatus?: null | string;
  revenueEntryIds: string[];
  totalAmount: string;
};

export type PaymentTableLabels = Partial<{
  acknowledge: string;
  action: string;
  amount: string;
  app: string;
  audit: string;
  commerce: string;
  empty: string;
  events: string;
  latestRun: string;
  loading: string;
  next: string;
  offlineRefund: string;
  order: string;
  previous: string;
  providerTrade: string;
  paymentMethod: string;
  refund: string;
  resolveRefund: string;
  retry: string;
  retryPayment: string;
  retryRefund: string;
  settle: string;
  status: string;
}>;

type PaymentTableProps = {
  canWrite?: boolean;
  error?: unknown;
  hasNext?: boolean;
  hasPrevious?: boolean;
  items?: ModuleAppPaymentDiagnosticRow[];
  labels?: PaymentTableLabels;
  loading?: boolean;
  onAcknowledge?: (discrepancyId: string) => void;
  onNext?: () => void;
  onOpenOfflineRefund?: (row: ModuleAppPaymentDiagnosticRow) => void;
  onOpenRefund?: (row: ModuleAppPaymentDiagnosticRow) => void;
  onOpenSettle?: (row: ModuleAppPaymentDiagnosticRow) => void;
  onPrevious?: () => void;
  onRetry?: () => void;
  onRetryPayment?: (outTradeNo: string, provider: PaymentProvider) => void;
  onRetryRefund?: (orderId: string) => void;
  onResolveRefund?: (orderId: string) => void;
  statusLabels?: Record<string, string>;
};

const defaultLabels = {
  acknowledge: 'Acknowledge discrepancy',
  action: 'Actions',
  amount: 'Amount',
  app: 'App',
  audit: 'Audit',
  commerce: 'License / revenue / payout',
  empty: 'No payment records',
  events: 'Events',
  latestRun: 'Latest app run',
  loading: 'Loading payment records',
  next: 'Next page',
  offlineRefund: 'Record offline refund',
  order: 'Order',
  paymentMethod: 'Payment method',
  previous: 'Previous page',
  providerTrade: 'Provider trade',
  refund: 'Refund payment',
  resolveRefund: 'Verify pending refund',
  retry: 'Retry',
  retryPayment: 'Retry payment query',
  retryRefund: 'Retry refund status',
  settle: 'Settle order',
  status: 'Status',
};

const IdList = ({ ids }: { ids: Array<null | string | undefined> }) => {
  const values = ids.filter((id): id is string => Boolean(id));
  return values.length ? (
    <Flexbox gap={2} style={{ maxWidth: 220 }}>
      {values.map((id) => (
        <Text code copyable key={id} style={{ overflowWrap: 'anywhere' }}>
          {id}
        </Text>
      ))}
    </Flexbox>
  ) : (
    '-'
  );
};

const PaymentReconciliationTable = memo<PaymentTableProps>(
  ({
    canWrite = false,
    error,
    hasNext,
    hasPrevious,
    items = [],
    labels,
    loading,
    onAcknowledge,
    onNext,
    onOpenOfflineRefund,
    onOpenRefund,
    onOpenSettle,
    onPrevious,
    onRetry,
    onRetryPayment,
    onRetryRefund,
    onResolveRefund,
    statusLabels,
  }) => {
    const copy = { ...defaultLabels, ...labels };
    const hasPager =
      hasNext !== undefined || hasPrevious !== undefined || Boolean(onNext) || Boolean(onPrevious);
    const columns = [
      { dataIndex: 'appName', key: 'appName', title: copy.app },
      {
        dataIndex: 'orderId',
        key: 'orderId',
        render: (value: string) => <IdList ids={[value]} />,
        title: copy.order,
      },
      {
        key: 'paymentMethod',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <Flexbox gap={2}>
            <Tag>{row.method}</Tag>
            <Text type="secondary">{row.provider}</Text>
          </Flexbox>
        ),
        title: copy.paymentMethod,
      },
      {
        dataIndex: 'outTradeNo',
        key: 'outTradeNo',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <IdList ids={[row.outTradeNo, row.providerTransactionId]} />
        ),
        title: copy.providerTrade,
      },
      {
        key: 'status',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <Flexbox gap={4}>
            <Tag color={row.paymentStatus === 'paid' ? 'green' : 'gold'}>
              {statusLabels?.[row.paymentStatus] ?? row.paymentStatus}
            </Tag>
            {row.refundStatus ? (
              <Tag>{statusLabels?.[row.refundStatus] ?? row.refundStatus}</Tag>
            ) : null}
            {row.discrepancyStatus ? (
              <Tag color="red">
                {statusLabels?.[row.discrepancyStatus] ?? row.discrepancyStatus}
              </Tag>
            ) : null}
          </Flexbox>
        ),
        title: copy.status,
      },
      {
        key: 'amount',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) =>
          `${row.currency} ${row.totalAmount}`,
        title: copy.amount,
      },
      {
        key: 'paymentEventIds',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <IdList ids={row.paymentEventIds} />
        ),
        title: copy.events,
      },
      {
        key: 'commerceIds',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <IdList ids={[...row.licenseIds, ...row.revenueEntryIds, ...row.payoutBatchIds]} />
        ),
        title: copy.commerce,
      },
      {
        key: 'latestAppRuntimeInvocationId',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <IdList ids={[row.latestAppRuntimeInvocationId]} />
        ),
        title: copy.latestRun,
      },
      {
        key: 'auditEventIds',
        render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
          <IdList ids={row.auditEventIds} />
        ),
        title: copy.audit,
      },
      ...(canWrite
        ? [
            {
              key: 'actions',
              render: (_: unknown, row: ModuleAppPaymentDiagnosticRow) => (
                <Flexbox horizontal gap={6} wrap="wrap">
                  {row.discrepancyStatus === 'open' && row.discrepancyIds[0] && onAcknowledge ? (
                    <Button onClick={() => onAcknowledge(row.discrepancyIds[0])}>
                      {copy.acknowledge}
                    </Button>
                  ) : null}
                  {row.outTradeNo && onRetryPayment ? (
                    <Button onClick={() => onRetryPayment(row.outTradeNo, row.provider)}>
                      {copy.retryPayment}
                    </Button>
                  ) : null}
                  {row.orderId &&
                  row.paymentStatus === 'paid' &&
                  row.refundStatus !== 'requested' &&
                  row.refundStatus !== 'succeeded' &&
                  onOpenRefund ? (
                    <Button onClick={() => onOpenRefund(row)}>{copy.refund}</Button>
                  ) : null}
                  {row.orderId &&
                  row.paymentStatus === 'paid' &&
                  row.refundStatus !== 'requested' &&
                  row.refundStatus !== 'succeeded' &&
                  onOpenOfflineRefund ? (
                    <Button onClick={() => onOpenOfflineRefund(row)}>{copy.offlineRefund}</Button>
                  ) : null}
                  {row.orderId &&
                  row.refundStatus &&
                  (row.provider !== 'zpay' || row.refundStatus !== 'requested') &&
                  onRetryRefund ? (
                    <Button onClick={() => onRetryRefund(row.orderId)}>{copy.retryRefund}</Button>
                  ) : null}
                  {row.orderId &&
                  row.provider === 'zpay' &&
                  row.refundStatus === 'requested' &&
                  onResolveRefund ? (
                    <Button onClick={() => onResolveRefund(row.orderId)}>
                      {copy.resolveRefund}
                    </Button>
                  ) : null}
                  {row.orderId && row.orderStatus !== 'paid' && onOpenSettle ? (
                    <Button onClick={() => onOpenSettle(row)}>{copy.settle}</Button>
                  ) : null}
                </Flexbox>
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

PaymentReconciliationTable.displayName = 'PaymentReconciliationTable';

export default PaymentReconciliationTable;
