import { Flexbox, Icon, Input, Tooltip } from '@lobehub/ui';
import { Button, Select, Text } from '@lobehub/ui/base-ui';
import { DatePicker, type TableColumnType } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs, { type Dayjs } from 'dayjs';
import { Braces, Database, FileImage, FileText, MessageSquareText, Video } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BusinessMobileRecordList from '@/business/client/BusinessSettingPages/mobile/BusinessMobileRecordList';
import {
  buildUsageRecord,
  type BusinessRecordFormatters,
} from '@/business/client/BusinessSettingPages/mobile/businessRecordBuilders';
import { formatCredits } from '@/business/client/BusinessSettingPages/shared';
import InlineTable from '@/components/InlineTable';
import { ProviderIcon } from '@/components/LobeIcons';
import SpendType, { type SpendTypeValue } from '@/components/SpendType';
import TablePagination from '@/components/TablePagination';
import { parseAsInteger, useQueryStates } from '@/hooks/useQueryParam';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';
import { type UsageRecordItem } from '@/types/usage/usageRecord';
import { formatDate, formatNumber } from '@/utils/format';

import { type UsageChartProps } from '../../types';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

const formatUsageSpend = (value: number) =>
  new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 6,
    minimumFractionDigits: 6,
    style: 'currency',
  }).format(value);

type UsageDateRange = [Dayjs | null, Dayjs | null] | null;

type SortField = 'createdAt' | 'credits' | 'spend' | 'tokens';

interface SortState {
  field: SortField;
  order: 'ascend' | 'descend';
}

const SORT_VALUES: Record<SortField, (row: UsageRecordItem) => number> = {
  createdAt: (row) => new Date(row.createdAt).getTime(),
  credits: (row) => row.credits ?? 0,
  spend: (row) => row.spend ?? 0,
  tokens: (row) => row.totalTokens ?? 0,
};

const styles = createStaticStyles(({ css }) => ({
  filterBar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    @media (width <= 768px) {
      display: grid;
      grid-template-columns: 1fr;
    }
  `,
  modelFilter: css`
    flex: 1 1 220px;
    min-width: 180px;

    @media (width <= 768px) {
      width: 100%;
    }
  `,
  typeFilter: css`
    flex: 0 1 160px;
    min-width: 140px;

    @media (width <= 768px) {
      width: 100%;
    }
  `,
  dateFilter: css`
    flex: 1 1 260px;
    min-width: 240px;

    @media (width <= 768px) {
      width: 100%;
    }
  `,
  pagination: css`
    padding-inline: 24px;
  `,
  tokenBreakdown: css`
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;
  `,
}));

const UsageTable = memo<UsageChartProps>(({ dateStrings, mobile }) => {
  const { t } = useTranslation('auth');
  const { t: tSubscription } = useTranslation('subscription');

  const [modelQuery, setModelQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>();
  const [dateRange, setDateRange] = useState<UsageDateRange>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const rangeStart = dateRange?.[0]?.format('YYYY-MM-DD');
  const rangeEnd = dateRange?.[1]?.format('YYYY-MM-DD');

  const { data, error, isLoading, mutate } = useClientDataSWR(
    [...statsKeys.usageLogs(), rangeStart ?? dateStrings ?? null, rangeEnd ?? null],
    async () =>
      rangeStart && rangeEnd
        ? usageService.findByDateRange(rangeStart, rangeEnd)
        : usageService.findByMonth(dateStrings),
  );

  // Page and page size move together — the size picker keeps the first visible
  // row in view, so it recalculates the page as well. One update, one
  // navigation: see `useQueryStates`.
  const [{ current: currentPage, pageSize }, setPagination] = useQueryStates(
    {
      current: parseAsInteger.withDefault(1),
      pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
    },
    { clearOnDefault: true },
  );

  useEffect(() => {
    if (dateStrings) void mutate();
  }, [dateStrings, mutate]);

  const typeLabels: Record<string, string> = {
    chat: t('usage.type.chat', { defaultValue: '\u5BF9\u8BDD' }),
    embedding: t('usage.type.embedding', { defaultValue: '\u5D4C\u5165' }),
    image: t('usage.type.image', { defaultValue: '\u56FE\u7247' }),
    imageGeneration: t('usage.type.image', { defaultValue: '\u56FE\u7247' }),
    ppt: t('usage.type.ppt', { defaultValue: 'PPT' }),
    speechRecognition: t('usage.type.speechRecognition', { defaultValue: '\u8BED\u97F3\u8F6C\u5199' }),
    structured_output: t('usage.type.structuredOutput', {
      defaultValue: '\u7ED3\u6784\u5316\u8F93\u51FA',
    }),
    video: t('usage.type.video', { defaultValue: '\u89C6\u9891' }),
    videoGeneration: t('usage.type.video', { defaultValue: '\u89C6\u9891' }),
  };
  const triggerLabels: Record<string, string> = {
    chat: '\u804A\u5929\u6D88\u606F',
    embedding: '\u5411\u91CF\u5D4C\u5165',
    image: '\u56FE\u7247\u751F\u6210',
    ppt: 'PPT \u751F\u6210',
    structured_output: '\u7ED3\u6784\u5316\u8F93\u51FA',
    video: '\u89C6\u9891\u751F\u6210',
  };
  const typeIcons = {
    chat: MessageSquareText,
    embedding: Database,
    image: FileImage,
    ppt: FileText,
    structured_output: Braces,
    video: Video,
  } as const;
  const spendTypeMap: Record<string, SpendTypeValue> = {
    chat: 'chat',
    embedding: 'embedding',
    image: 'imageGeneration',
    imageGeneration: 'imageGeneration',
    speechRecognition: 'speechRecognition',
    video: 'videoGeneration',
    videoGeneration: 'videoGeneration',
  };

  const filteredData = useMemo(() => {
    const normalizedQuery = modelQuery.trim().toLocaleLowerCase();
    const [from, to] = dateRange ?? [];

    return ((data ?? []) as UsageRecordItem[]).filter((record) => {
      if (
        normalizedQuery &&
        !`${record.model} ${record.provider}`.toLocaleLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }

      if (typeFilter && record.type !== typeFilter) return false;

      const createdAt = dayjs(record.createdAt);
      if (from && createdAt.isBefore(from, 'day')) return false;
      if (to && createdAt.isAfter(to, 'day')) return false;

      return true;
    });
  }, [data, dateRange, modelQuery, typeFilter]);

  const sortedData = useMemo(() => {
    const getValue = sort && SORT_VALUES[sort.field];
    if (!getValue) return filteredData;

    const direction = sort.order === 'ascend' ? 1 : -1;
    return [...filteredData].sort((a, b) => (getValue(a) - getValue(b)) * direction);
  }, [filteredData, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const normalizedPage = Math.min(Math.max(currentPage, 1), pageCount);
  const paginatedData = useMemo(() => {
    const start = (normalizedPage - 1) * pageSize;

    return sortedData.slice(start, start + pageSize);
  }, [normalizedPage, pageSize, sortedData]);

  const resetPage = () => {
    setPagination({ current: 1 });
  };

  const resetFilters = () => {
    setModelQuery('');
    setTypeFilter(undefined);
    setDateRange(null);
    setSort(null);
    resetPage();
  };

  const hasFilters = Boolean(modelQuery || typeFilter || dateRange);

  const filterControls = (
    <Flexbox horizontal className={styles.filterBar} width="100%">
      <Input
        allowClear
        aria-label={t('usage.filter.model', { defaultValue: '\u641C\u7D22\u6A21\u578B' })}
        className={styles.modelFilter}
        placeholder={t('usage.filter.model', { defaultValue: '\u641C\u7D22\u6A21\u578B' })}
        value={modelQuery}
        onChange={(event) => {
          setModelQuery(event.target.value);
          resetPage();
        }}
      />
      <Select
        allowClear
        aria-label={t('usage.filter.type', { defaultValue: '\u7C7B\u578B' })}
        className={styles.typeFilter}
        options={Object.entries(typeLabels).map(([value, label]) => ({ label, value }))}
        placeholder={t('usage.filter.type', { defaultValue: '\u5168\u90E8\u7C7B\u578B' })}
        value={typeFilter}
        onChange={(value) => {
          setTypeFilter(value);
          resetPage();
        }}
      />
      <DatePicker.RangePicker
        allowClear
        className={styles.dateFilter}
        format="YYYY/MM/DD"
        value={dateRange}
        placeholder={[
          t('usage.filter.startDate', { defaultValue: '\u5F00\u59CB\u65E5\u671F' }),
          t('usage.filter.endDate', { defaultValue: '\u7ED3\u675F\u65E5\u671F' }),
        ]}
        onChange={(values) => {
          setDateRange(values ? [values[0], values[1]] : null);
          resetPage();
        }}
      />
      <Button disabled={!hasFilters} onClick={resetFilters}>
        {t('usage.filter.reset', { defaultValue: '\u91CD\u7F6E' })}
      </Button>
    </Flexbox>
  );

  const columns: TableColumnType<any>[] = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value) => dayjs(value).format('MM-DD HH:mm:ss'),
      sorter: true,
      sortOrder: sort?.field === 'createdAt' ? sort.order : null,
      title: '\u65F6\u95F4',
      width: 150,
    },
    {
      dataIndex: 'type',
      key: 'type',
      render: (value) => {
        const mappedType = spendTypeMap[value];
        if (mappedType) {
          return <SpendType type={mappedType}>{typeLabels[value] ?? value}</SpendType>;
        }

        return (
          <Tooltip title={typeLabels[value] ?? value}>
            <Icon
              icon={typeIcons[value as keyof typeof typeIcons] ?? MessageSquareText}
              size={16}
            />
          </Tooltip>
        );
      },
      title: '\u7C7B\u578B',
      width: 64,
    },
    {
      dataIndex: 'type',
      key: 'trigger',
      render: (value) => triggerLabels[value] ?? typeLabels[value] ?? value,
      title: '\u89E6\u53D1\u65B9\u5F0F',
    },
    {
      dataIndex: 'model',
      key: 'model',
      render: (value, record) => (
        <Flexbox horizontal align="center" gap={8}>
          <ProviderIcon
            provider={record.provider}
            size={18}
            style={{
              border: `2px solid ${cssVar.colorBgContainer}`,
              boxSizing: 'content-box',
            }}
          />
          <Tooltip title={value}>
            <Text>{value?.length > 12 ? `${value.slice(0, 12)}...` : value}</Text>
          </Tooltip>
        </Flexbox>
      ),
      title: '\u6A21\u578B',
    },
    {
      dataIndex: 'totalTokens',
      key: 'tokens',
      render: (_, record) => (
        <span className={styles.tokenBreakdown}>
          <strong>{formatNumber(record.totalTokens ?? 0)}</strong>
          <span>=</span>
          <span>{formatNumber(record.totalInputTokens ?? 0)}</span>
          <span>+</span>
          <span>{formatNumber(record.totalOutputTokens ?? 0)}</span>
        </span>
      ),
      sorter: true,
      sortOrder: sort?.field === 'tokens' ? sort.order : null,
      title: 'Token \u4F7F\u7528\u91CF',
      width: 180,
    },
    {
      align: 'end',
      dataIndex: 'spend',
      key: 'spend',
      render: (value) => formatUsageSpend(value ?? 0),
      sorter: true,
      sortOrder: sort?.field === 'spend' ? sort.order : null,
      title: t('usage.table.spend', { defaultValue: 'Spend' }),
    },
    {
      align: 'end',
      dataIndex: 'credits',
      key: 'credits',
      render: (_, record) => formatNumber(record.credits ?? 0),
      sorter: true,
      sortOrder: sort?.field === 'credits' ? sort.order : null,
      title: '\u6D88\u8017\u79EF\u5206',
    },
    {
      key: 'duration',
      render: (_, record: UsageRecordItem) => {
        const duration =
          record.metadata?.performance?.latency ?? record.metadata?.performance?.duration;

        if (!duration) return '--';

        return (
          <Tooltip
            title={`TTFT ${formatNumber((record.ttft ?? 0) / 1000, 2)}s \u00B7 TPS ${formatNumber(record.tps ?? 0, 2)}`}
          >
            <span>{formatNumber(duration / 1000, 2)}s</span>
          </Tooltip>
        );
      },
      title: '\u8017\u65F6',
    },
  ];

  const usageFormatters: Pick<
    BusinessRecordFormatters,
    'formatCredits' | 'formatCurrency' | 'formatDate' | 'formatNumber' | 't'
  > = {
    formatCredits,
    formatCurrency: formatUsageSpend,
    formatDate: (value) => (value ? formatDate(new Date(value)) : '--'),
    formatNumber,
    t: (key, options) =>
      key.startsWith('mobile.')
        ? tSubscription(key as any, options as any)
        : t(key as any, options as any),
  };

  return (
    <Flexbox gap={12} width="100%">
      {filterControls}
      {mobile ? (
        <BusinessMobileRecordList
          emptyDescription={tSubscription('mobile.usage.records.empty')}
          error={error ? tSubscription('mobile.error.title') : undefined}
          isLoading={isLoading}
          records={sortedData.map((item) => buildUsageRecord(item, usageFormatters))}
          sheetTitle={tSubscription('mobile.usage.records.details')}
          onRetry={() => void mutate()}
        />
      ) : (
        <>
          <InlineTable
            columns={columns}
            dataSource={paginatedData}
            loading={isLoading}
            size="small"
            rowKey={(record) =>
              record.id || `${record.model}-${record.createdAt}-${record.provider}`
            }
            onChange={(_pagination, _filters, sorter) => {
              const next = Array.isArray(sorter) ? sorter[0] : sorter;
              const field = String(next?.columnKey ?? '') as SortField;
              setSort(next?.order && SORT_VALUES[field] ? { field, order: next.order } : null);
              resetPage();
            }}
          />
          {sortedData.length > 0 && (
            <TablePagination
              className={styles.pagination}
              current={normalizedPage}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              total={sortedData.length}
              onChange={(nextPage, nextPageSize) => {
                setPagination({ current: nextPage, pageSize: nextPageSize });
              }}
            />
          )}
        </>
      )}
    </Flexbox>
  );
});

export default UsageTable;
