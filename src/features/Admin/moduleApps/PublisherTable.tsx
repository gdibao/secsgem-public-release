'use client';

import type { ModuleAppPublisherStatus } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { type TableProps, Tag, Typography } from 'antd';
import { memo, type ReactNode } from 'react';

import InlineTable from '@/components/InlineTable';

import { AdminTableState } from './AdminTableState';
import CursorPager from './CursorPager';

const { Text } = Typography;

export type ModuleAppPublisherRow = {
  appCount: number;
  createdAt?: Date | string;
  displayName: string;
  id: string;
  recipientMask?: null | string;
  status: ModuleAppPublisherStatus;
  userId: string;
};

export type PublisherTableLabels = {
  columns: {
    apps: string;
    id: string;
    owner: string;
    publisher: string;
    recipient: string;
    status: string;
  };
  empty: string;
  loading: string;
  next: string;
  previous: string;
  retry: string;
  status: Record<ModuleAppPublisherRow['status'], string>;
};

type PublisherTableLabelOverrides = Omit<Partial<PublisherTableLabels>, 'columns' | 'status'> & {
  columns?: Partial<PublisherTableLabels['columns']>;
  status?: Partial<PublisherTableLabels['status']>;
};

const defaultLabels: PublisherTableLabels = {
  columns: {
    apps: 'Apps',
    id: 'ID',
    owner: 'Owner',
    publisher: 'Publisher',
    recipient: 'Alipay recipient',
    status: 'Status',
  },
  empty: 'No publishers',
  loading: 'Loading publishers',
  next: 'Next page',
  previous: 'Previous page',
  retry: 'Retry',
  status: {
    pending: 'Pending',
    suspended: 'Suspended',
    verified: 'Verified',
  },
};

const PublisherTable = memo(
  ({
    error,
    hasNext,
    hasPrevious,
    items = [],
    labels,
    loading,
    onNext,
    actionsTitle = 'Actions',
    renderActions,
    onPrevious,
    onRetry,
    showPager,
  }: {
    error?: unknown;
    actionsTitle?: string;
    hasNext?: boolean;
    hasPrevious?: boolean;
    items?: ModuleAppPublisherRow[];
    labels?: PublisherTableLabelOverrides;
    loading?: boolean;
    onNext?: () => void;
    onPrevious?: () => void;
    onRetry?: () => void;
    renderActions?: (publisher: ModuleAppPublisherRow) => ReactNode;
    showPager?: boolean;
  }) => {
    const resolvedLabels: PublisherTableLabels = {
      ...defaultLabels,
      ...labels,
      columns: { ...defaultLabels.columns, ...labels?.columns },
      status: { ...defaultLabels.status, ...labels?.status },
    };
    const columns: NonNullable<TableProps<ModuleAppPublisherRow>['columns']> = [
      {
        dataIndex: 'displayName',
        key: 'displayName',
        title: resolvedLabels.columns.publisher,
      },
      {
        dataIndex: 'id',
        key: 'id',
        render: (value: string) => (
          <Text code copyable>
            {value}
          </Text>
        ),
        title: resolvedLabels.columns.id,
      },
      {
        dataIndex: 'userId',
        key: 'userId',
        render: (value: string) => <Text code>{value}</Text>,
        title: resolvedLabels.columns.owner,
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: ModuleAppPublisherStatus) => (
          <Tag color={value === 'verified' ? 'green' : value === 'suspended' ? 'red' : 'gold'}>
            {resolvedLabels.status[value]}
          </Tag>
        ),
        title: resolvedLabels.columns.status,
      },
      {
        dataIndex: 'recipientMask',
        key: 'recipientMask',
        title: resolvedLabels.columns.recipient,
      },
      { dataIndex: 'appCount', key: 'appCount', title: resolvedLabels.columns.apps },
    ];
    if (renderActions) {
      columns.push({
        key: 'actions',
        render: (_: unknown, publisher: ModuleAppPublisherRow) => renderActions(publisher),
        title: actionsTitle,
      });
    }
    return (
      <Flexbox gap={10}>
        <AdminTableState
          emptyLabel={resolvedLabels.empty}
          error={error}
          loading={loading}
          loadingLabel={resolvedLabels.loading}
          retryLabel={resolvedLabels.retry}
          onRetry={onRetry}
        >
          {items.length ? (
            <InlineTable
              columns={columns as TableProps['columns']}
              dataSource={items}
              rowKey="id"
            />
          ) : null}
        </AdminTableState>
        {(showPager ?? Boolean(hasNext || hasPrevious || onNext || onPrevious)) ? (
          <CursorPager
            hasNext={hasNext}
            hasPrevious={hasPrevious}
            nextLabel={resolvedLabels.next}
            previousLabel={resolvedLabels.previous}
            onNext={onNext}
            onPrevious={onPrevious}
          />
        ) : null}
      </Flexbox>
    );
  },
);

PublisherTable.displayName = 'PublisherTable';

export default PublisherTable;
