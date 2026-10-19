'use client';

import { Flexbox } from '@lobehub/ui';
import { Select, Tabs } from '@lobehub/ui/base-ui';
import { type TableColumnType } from 'antd';
import { Empty, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { commercialService } from '@/services/commercial';
import {
  type CreditPackageHistoryItem,
  type CreditPackageStatusType,
  type CreditSourceType,
} from '@/types/business';

import BusinessMobileRecordList from './mobile/BusinessMobileRecordList';
import {
  buildCreditPackageRecord,
  type BusinessRecordFormatters,
} from './mobile/businessRecordBuilders';
import { formatBusinessDate, formatCredits } from './shared';

const styles = createStaticStyles(({ css }) => ({
  controls: css`
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr);
    gap: 8px;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
}));

const statusLabels: Record<CreditPackageStatusType, string> = {
  active: '有效',
  depleted: '已用尽',
  expired: '已过期',
};

const sourceLabels: Record<CreditSourceType, string> = {
  other: '其他',
  referral: '推荐奖励',
  subscription: '订阅赠送',
  topup: '充值',
};

type CreditPackageSort = 'balanceAsc' | 'balanceDesc' | 'newest' | 'oldest';

interface CreditPackageListProps {
  mobile?: boolean;
}

const CreditPackageList = memo<CreditPackageListProps>(({ mobile }) => {
  const { t } = useTranslation('subscription');
  const [source, setSource] = useState<CreditSourceType>();
  const [status, setStatus] = useState<CreditPackageStatusType>('active');
  const [sort, setSort] = useState<CreditPackageSort>('newest');
  const {
    data = [],
    error,
    isLoading,
    mutate,
  } = useClientDataSWR(['commercial.listCreditPackages'], () =>
    commercialService.listCreditPackages({ limit: 100 }),
  );

  const counts = useMemo(
    () => ({
      active: data.filter((item) => item.status === 'active').length,
      depleted: data.filter((item) => item.status === 'depleted').length,
      expired: data.filter((item) => item.status === 'expired').length,
    }),
    [data],
  );

  const visiblePackages = useMemo(() => {
    const items = data.filter(
      (item) => item.status === status && (!source || item.source === source),
    );

    return items.toSorted((left, right) => {
      switch (sort) {
        case 'oldest': {
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        }
        case 'balanceAsc': {
          return left.remainingAmount - right.remainingAmount;
        }
        case 'balanceDesc': {
          return right.remainingAmount - left.remainingAmount;
        }
        default: {
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        }
      }
    });
  }, [data, sort, source, status]);

  const recordFormatters: Pick<BusinessRecordFormatters, 'formatCredits' | 'formatDate' | 't'> = {
    formatCredits,
    formatDate: formatBusinessDate,
    t: (key, options) => t(key as any, options as any),
  };

  const columns: TableColumnType<CreditPackageHistoryItem>[] = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value) => formatBusinessDate(value),
      title: '获得时间',
    },
    {
      dataIndex: 'source',
      key: 'source',
      render: (_, record) => sourceLabels[record.source],
      title: '来源',
    },
    {
      dataIndex: 'grantedAmount',
      key: 'grantedAmount',
      render: (value) => formatCredits(value),
      title: '积分包',
    },
    {
      dataIndex: 'remainingAmount',
      key: 'remainingAmount',
      render: (value) => formatCredits(value),
      title: '剩余积分',
    },
    {
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (value) => formatBusinessDate(value, 'YYYY-MM-DD'),
      title: '有效期至',
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (_, record) => <Tag>{statusLabels[record.status]}</Tag>,
      title: '状态',
    },
  ];

  return (
    <Flexbox gap={12}>
      <div className={styles.controls}>
        <Select
          allowClear
          options={Object.entries(sourceLabels).map(([value, label]) => ({ label, value }))}
          placeholder="全部来源"
          value={source}
          onChange={(value) => setSource(value as CreditSourceType | undefined)}
        />
        <Select
          value={sort}
          options={[
            { label: '最新', value: 'newest' },
            { label: '最早', value: 'oldest' },
            { label: '余额从高到低', value: 'balanceDesc' },
            { label: '余额从低到高', value: 'balanceAsc' },
          ]}
          onChange={(value) => setSort(value as CreditPackageSort)}
        />
      </div>
      <Tabs
        activeKey={status}
        items={(Object.keys(statusLabels) as CreditPackageStatusType[]).map((key) => ({
          key,
          label: `${statusLabels[key]}（${counts[key]}）`,
        }))}
        onChange={(key) => setStatus(key as CreditPackageStatusType)}
      />
      {mobile ? (
        <BusinessMobileRecordList
          emptyDescription="暂无积分包"
          error={error ? t('mobile.error.title') : undefined}
          isLoading={isLoading}
          records={visiblePackages.map((item) => buildCreditPackageRecord(item, recordFormatters))}
          sheetTitle="积分包详情"
          onRetry={() => void mutate()}
        />
      ) : (
        <InlineTable
          columns={columns as any}
          dataSource={visiblePackages}
          loading={isLoading}
          rowKey={(record) => record.id}
          locale={{
            emptyText: (
              <Empty
                description={
                  status === 'active' ? '暂无积分包，购买您的第一个积分包' : '暂无符合条件的积分包'
                }
              />
            ),
          }}
        />
      )}
    </Flexbox>
  );
});

CreditPackageList.displayName = 'CreditPackageList';
export default CreditPackageList;
