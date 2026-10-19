'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { Checkbox, Tag, Typography } from 'antd';
import { memo, useMemo, useState } from 'react';

import InlineTable from '@/components/InlineTable';

const { Text } = Typography;

export type ModuleAppRevenueRow = {
  appId: string;
  createdAt?: Date | string;
  currency: string;
  developerAmount: number;
  grossAmount: number;
  id: string;
  orderId: string;
  platformFee: number;
  publisherUserId?: null | string;
  reserveAmount: number;
  settlementBatchId?: null | string;
  status: string;
  type: string;
};

export type CommerceTableLabels = Partial<{
  cancel: string;
  confirmDescription: string;
  confirmSettlement: string;
  confirmTitle: string;
  description: string;
  developer: string;
  gross: string;
  order: string;
  platform: string;
  platformFee: string;
  publisher: string;
  reserve: string;
  select: string;
  settle: string;
  status: string;
  type: string;
}>;

type CommerceTableProps = {
  canWrite?: boolean;
  items?: ModuleAppRevenueRow[];
  labels?: CommerceTableLabels;
  loading?: boolean;
  onSettle: (entryIds: string[]) => Promise<void>;
  statusLabels?: Record<string, string>;
  typeLabels?: Record<string, string>;
};

const defaultLabels = {
  cancel: 'Cancel',
  confirmDescription: 'Selected revenue entries and developer amount',
  confirmSettlement: 'Confirm settlement',
  confirmTitle: 'Confirm revenue settlement',
  description: 'Product revenue only. Runtime, AI, storage, and network costs are excluded.',
  developer: 'Developer',
  gross: 'Gross',
  order: 'Order',
  platform: 'Platform',
  platformFee: 'Platform fee',
  publisher: 'Publisher',
  reserve: 'Reserve',
  select: 'Select revenue',
  settle: 'Settle selected',
  status: 'Status',
  type: 'Type',
};

const formatAmount = (value: number, currency: string) =>
  `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;

const CommerceTable = memo<CommerceTableProps>(
  ({ canWrite = true, items = [], labels, loading, onSettle, statusLabels, typeLabels }) => {
    const copy = { ...defaultLabels, ...labels };
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [confirming, setConfirming] = useState(false);
    const [settling, setSettling] = useState(false);
    const selectableIds = useMemo(
      () =>
        new Set(
          items
            .filter((item) => item.type === 'accrual' && item.status === 'pending')
            .map((item) => item.id),
        ),
      [items],
    );
    const validSelectedIds = selectedIds.filter((id) => selectableIds.has(id));
    const selectedRows = items.filter((item) => validSelectedIds.includes(item.id));
    const selectedAmount = Array.from(
      selectedRows.reduce((totals, item) => {
        totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.developerAmount);
        return totals;
      }, new Map<string, number>()),
    )
      .map(([currency, amount]) => formatAmount(amount, currency))
      .join(', ');

    const toggle = (id: string, checked: boolean) => {
      setSelectedIds((current) =>
        checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id),
      );
    };

    const settle = async () => {
      const entryIds = validSelectedIds;
      if (entryIds.length === 0) return;
      setSettling(true);
      try {
        await onSettle(entryIds);
        setSelectedIds([]);
        setConfirming(false);
      } finally {
        setSettling(false);
      }
    };

    const columns = [
      ...(canWrite
        ? [
            {
              key: 'select',
              render: (_: unknown, row: ModuleAppRevenueRow) => {
                const selectable = selectableIds.has(row.id);
                return (
                  <Checkbox
                    aria-label={`${copy.select} ${row.id}`}
                    checked={selectedIds.includes(row.id)}
                    disabled={!selectable}
                    onChange={(event) => toggle(row.id, event.target.checked)}
                  />
                );
              },
              width: 48,
            },
          ]
        : []),
      {
        dataIndex: 'orderId',
        key: 'orderId',
        render: (value: string) => <Text code>{value}</Text>,
        title: copy.order,
      },
      {
        dataIndex: 'publisherUserId',
        key: 'publisherUserId',
        render: (value?: null | string) => value ?? copy.platform,
        title: copy.publisher,
      },
      {
        dataIndex: 'type',
        key: 'type',
        render: (value: string) => <Tag>{typeLabels?.[value] ?? value}</Tag>,
        title: copy.type,
      },
      {
        key: 'gross',
        render: (_: unknown, row: ModuleAppRevenueRow) =>
          formatAmount(row.grossAmount, row.currency),
        title: copy.gross,
      },
      {
        key: 'platform',
        render: (_: unknown, row: ModuleAppRevenueRow) =>
          formatAmount(row.platformFee, row.currency),
        title: copy.platformFee,
      },
      {
        key: 'reserve',
        render: (_: unknown, row: ModuleAppRevenueRow) =>
          formatAmount(row.reserveAmount, row.currency),
        title: copy.reserve,
      },
      {
        key: 'developer',
        render: (_: unknown, row: ModuleAppRevenueRow) =>
          formatAmount(row.developerAmount, row.currency),
        title: copy.developer,
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: string) => (
          <Tag color={value === 'settled' ? 'green' : value === 'reversed' ? 'red' : 'gold'}>
            {statusLabels?.[value] ?? value}
          </Tag>
        ),
        title: copy.status,
      },
    ];

    return (
      <Flexbox data-testid="admin-module-app-commerce-table" gap={12}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text type="secondary">{copy.description}</Text>
          {canWrite ? (
            <Button
              disabled={validSelectedIds.length === 0}
              type="primary"
              onClick={() => setConfirming(true)}
            >
              {copy.settle}
            </Button>
          ) : null}
        </Flexbox>
        <InlineTable columns={columns as any} dataSource={items} loading={loading} rowKey="id" />
        {canWrite ? (
          <Modal
            cancelText={copy.cancel}
            confirmLoading={settling}
            okButtonProps={{ disabled: settling || validSelectedIds.length === 0 }}
            okText={copy.confirmSettlement}
            open={confirming}
            title={copy.confirmTitle}
            onCancel={() => !settling && setConfirming(false)}
            onOk={settle}
          >
            <p>{`${copy.confirmDescription}: ${validSelectedIds.length}, ${selectedAmount}`}</p>
          </Modal>
        ) : null}
      </Flexbox>
    );
  },
);

CommerceTable.displayName = 'CommerceTable';

export default CommerceTable;
