import type { ModuleAppScopeType } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  Alert,
  Button,
  Empty,
  Pagination,
  Table,
  type TableColumnsType,
  Typography,
} from 'antd';
import { createStaticStyles } from 'antd-style';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { moduleAppService } from '@/services/moduleApp';

import {
  getModuleAppRecordListKey,
  type ModuleAppRecordData,
  type ModuleAppRecordPage,
} from './recordRuntime';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    width: 100%;
    min-width: 0;
    padding: 24px;
    background: ${cssVar.colorBgLayout};
  `,
  table: css`
    width: 100%;
  `,
}));

interface RecordListProps {
  appId: string;
  collectionKey: string;
  createHref?: string;
  editHref?: (record: ModuleAppRecordData) => string;
  onEdit?: (record: ModuleAppRecordData) => void;
  pageSize?: number;
  scopeType: ModuleAppScopeType;
  workspaceId?: string;
}

const formatUpdatedAt = (value?: Date | string) => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const RecordList = memo<RecordListProps>(
  ({ appId, collectionKey, createHref, editHref, onEdit, pageSize = 20, scopeType, workspaceId }) => {
    const { t } = useTranslation('common');
    const [page, setPage] = useState(1);
    const query = {
      appId,
      collectionKey,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      scopeType,
      workspaceId,
    };
    const records = useSWR<ModuleAppRecordPage>(getModuleAppRecordListKey(query), () =>
      moduleAppService.listRecords(query) as Promise<ModuleAppRecordPage>,
    );
    const total = records.data?.total;

    useEffect(() => {
      if (total === undefined) return;
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      if (page > lastPage) setPage(lastPage);
    }, [page, pageSize, total]);

    const columns = useMemo<TableColumnsType<ModuleAppRecordData>>(
      () => [
        {
          dataIndex: 'title',
          key: 'title',
          render: (value: null | string | undefined, record: ModuleAppRecordData) => (
            <Typography.Text>{value || record.id}</Typography.Text>
          ),
          title: t('moduleApps.runtime.records.title'),
        },
        {
          dataIndex: 'updatedAt',
          key: 'updatedAt',
          render: (value?: Date | string) => formatUpdatedAt(value),
          title: t('moduleApps.runtime.records.updatedAt'),
          width: 220,
        },
        ...(onEdit || editHref
          ? [
              {
                key: 'actions',
                render: (_: unknown, record: ModuleAppRecordData) => (
                  <Button
                    aria-label={t('moduleApps.runtime.records.edit')}
                    href={editHref?.(record)}
                    icon={<Pencil size={15} />}
                    type="text"
                    onClick={onEdit ? () => onEdit(record) : undefined}
                  />
                ),
                title: '',
                width: 56,
              },
            ]
          : []),
      ],
      [editHref, onEdit, t],
    );

    if (records.isLoading) {
      return (
        <Flexbox align="center" className={styles.root} justify="center" padding={48}>
          <NeuralNetworkLoading size={36} />
        </Flexbox>
      );
    }

    if (records.error) {
      return (
        <Flexbox className={styles.root} gap={12}>
          <Alert showIcon message={t('moduleApps.runtime.records.loadError')} type="error" />
          <Button icon={<RefreshCw size={16} />} onClick={() => void records.mutate()}>
            {t('moduleApps.runtime.retry')}
          </Button>
        </Flexbox>
      );
    }

    if (!records.data?.items.length) {
      return (
        <Flexbox className={styles.root} padding={48}>
          <Empty description={t('moduleApps.runtime.records.empty')}>
            {createHref && (
              <Button href={createHref} icon={<Plus size={16} />} type="primary">
                {t('moduleApps.runtime.records.create')}
              </Button>
            )}
          </Empty>
        </Flexbox>
      );
    }

    return (
      <Flexbox className={styles.root} data-testid="module-app-record-list" gap={16}>
        <Table<ModuleAppRecordData>
          className={styles.table}
          columns={columns}
          dataSource={records.data.items}
          pagination={false}
          rowKey="id"
          size="middle"
        />
        {records.data.total > pageSize && (
          <Flexbox horizontal justify="flex-end">
            <Pagination
              current={page}
              pageSize={pageSize}
              showSizeChanger={false}
              total={records.data.total}
              onChange={setPage}
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

RecordList.displayName = 'RecordList';

export default RecordList;
