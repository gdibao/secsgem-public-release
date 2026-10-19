'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, confirmModal, Select, toast } from '@lobehub/ui/base-ui';
import { Alert, Space, type TableProps, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import InlineTable from '@/components/InlineTable';
import { formatAdminCredits } from '@/features/Admin/adminCreditUnits';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    display: grid;
    gap: 2px;
    max-width: 420px;
  `,
  errorMessage: css`
    overflow: hidden;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  page: css`
    display: grid;
    gap: 16px;
    min-width: 0;
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
    justify-content: space-between;
  `,
  toolbarField: css`
    display: grid;
    gap: 6px;

    min-width: 180px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

type SettlementFailureStatus = 'pending' | 'resolved';

type CreditSettlementFailureRow = {
  actualAmount: number | string;
  attempts: number;
  createdAt: Date | string;
  errorCode: null | string;
  errorMessage: string;
  id: string;
  lastAttemptAt: Date | string;
  payerScopeType: 'personal' | 'workspace';
  payerUserId: null | string;
  payerWorkspaceId: null | string;
  reservationId: string;
  reservationStatus: string;
  resolvedAt: Date | null | string;
  status: SettlementFailureStatus;
  updatedAt: Date | string;
};

type CreditSettlementFailureListResponse = {
  items: CreditSettlementFailureRow[];
  nextCursor: null | number;
};

const PAGE_SIZE = 25;
const SETTLEMENT_STATUSES = ['pending', 'resolved'] as const;
const formatDateTime = (value: Date | string) => new Date(value).toLocaleString();

const CreditSettlementFailuresPage = memo<{ canWrite?: boolean }>(
  ({ canWrite: canWriteOverride }) => {
    const { t } = useTranslation('subscription');
    const [searchParams, setSearchParams] = useSearchParams();
    const role = useUserStore(
      (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
    );
    const canWrite = canWriteOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
    const cursorValue = Number(searchParams.get('settlementCursor') ?? 0);
    const cursor = Number.isInteger(cursorValue) && cursorValue >= 0 ? cursorValue : 0;
    const statusValue = searchParams.get('settlementStatus');
    const status = SETTLEMENT_STATUSES.includes(statusValue as SettlementFailureStatus)
      ? (statusValue as SettlementFailureStatus)
      : undefined;
    const [busyId, setBusyId] = useState<string>();
    const swrKey = useMemo(
      () => ['admin-credit-settlement-failures', cursor, status] as const,
      [cursor, status],
    );
    const { data, error, isLoading } = useClientDataSWR<CreditSettlementFailureListResponse>(
      swrKey,
      () =>
        adminCommercialService.listCreditSettlementFailures({
          cursor,
          limit: PAGE_SIZE,
          ...(status ? { status } : {}),
        }),
    );

    const updateParams = (nextValues: {
      settlementCursor?: null | number;
      settlementStatus?: null | SettlementFailureStatus;
    }) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(nextValues)) {
          if (value === null || value === undefined || value === 0) next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      });
    };

    const retry = async (row: CreditSettlementFailureRow) => {
      setBusyId(row.id);
      try {
        await adminCommercialService.retryCreditSettlementFailure(row.id);
        toast.success(
          t('admin.payments.settlements.retrySuccess', 'Settlement completed and marked resolved'),
        );
        await mutate(swrKey);
      } catch (retryError) {
        toast.error(
          retryError instanceof Error
            ? retryError.message
            : t('admin.payments.settlements.retryFailed', 'Unable to retry settlement'),
        );
      } finally {
        setBusyId(undefined);
      }
    };

    const columns: TableProps<CreditSettlementFailureRow>['columns'] = [
      {
        key: 'reservation',
        render: (_, row) => (
          <div>
            <div>{row.reservationId}</div>
            <small>{row.id}</small>
          </div>
        ),
        title: t('admin.payments.settlements.columns.reservation', 'Reservation / failure'),
        width: 300,
      },
      {
        key: 'payer',
        render: (_, row) =>
          row.payerScopeType === 'workspace'
            ? (row.payerWorkspaceId ?? '-')
            : (row.payerUserId ?? '-'),
        title: t('admin.payments.settlements.columns.payer', 'Payer'),
        width: 220,
      },
      {
        dataIndex: 'actualAmount',
        key: 'actualAmount',
        render: (value) => formatAdminCredits(Number(value)),
        title: t('admin.payments.settlements.columns.amount', 'Actual credits'),
        width: 130,
      },
      {
        key: 'error',
        render: (_, row) => (
          <div className={styles.error} title={row.errorMessage}>
            <strong>{row.errorCode ?? 'SETTLEMENT_FAILED'}</strong>
            <span className={styles.errorMessage}>{row.errorMessage}</span>
          </div>
        ),
        title: t('admin.payments.settlements.columns.error', 'Last error'),
        width: 360,
      },
      {
        key: 'attempts',
        render: (_, row) => (
          <div>
            <div>{row.attempts}</div>
            <small>{formatDateTime(row.lastAttemptAt)}</small>
          </div>
        ),
        title: t('admin.payments.settlements.columns.attempts', 'Attempts'),
        width: 180,
      },
      {
        key: 'status',
        render: (_, row) => (
          <Space direction="vertical" size={2}>
            <Tag color={row.status === 'resolved' ? 'green' : 'red'}>
              {t(`admin.payments.settlements.status.${row.status}`, row.status)}
            </Tag>
            <small>{row.reservationStatus}</small>
          </Space>
        ),
        title: t('admin.payments.settlements.columns.status', 'Status'),
        width: 130,
      },
      {
        fixed: 'right',
        key: 'actions',
        render: (_, row) =>
          canWrite && row.status === 'pending' ? (
            <Button
              icon={<RotateCcw aria-hidden size={16} />}
              loading={busyId === row.id}
              size="small"
              onClick={() =>
                confirmModal({
                  cancelText: t('cancel', 'Cancel'),
                  content: t(
                    'admin.payments.settlements.retryConfirmDescription',
                    'Retry the original settlement. A successful retry will debit the recorded actual credits.',
                  ),
                  okText: t('admin.payments.settlements.retry', 'Retry settlement'),
                  onOk: () => retry(row),
                  title: t('admin.payments.settlements.retryConfirmTitle', 'Retry settlement?'),
                })
              }
            >
              {t('admin.payments.settlements.retry', 'Retry settlement')}
            </Button>
          ) : null,
        title: t('admin.payments.settlements.columns.actions', 'Actions'),
        width: 170,
      },
    ];

    return (
      <section className={styles.page} data-testid="credit-settlement-failures-page">
        <div className={styles.toolbar}>
          <div>
            <strong>{t('admin.payments.settlements.title', 'Credit settlement failures')}</strong>
            <div>
              {t(
                'admin.payments.settlements.description',
                'Review persisted model and module billing failures, then retry them without duplicating settled charges.',
              )}
            </div>
          </div>
          <Button icon={<RefreshCw aria-hidden size={16} />} onClick={() => mutate(swrKey)}>
            {t('admin.payments.settlements.refresh', 'Refresh list')}
          </Button>
        </div>
        <label className={styles.toolbarField}>
          {t('admin.payments.settlements.filters.status', 'Status')}
          <Select
            value={status ?? ''}
            options={[
              { label: t('admin.payments.settlements.filters.all', 'All'), value: '' },
              {
                label: t('admin.payments.settlements.status.pending', 'Pending'),
                value: 'pending',
              },
              {
                label: t('admin.payments.settlements.status.resolved', 'Resolved'),
                value: 'resolved',
              },
            ]}
            onChange={(value) => {
              const nextStatus = String(value || '');
              updateParams({
                settlementCursor: null,
                settlementStatus: nextStatus ? (nextStatus as SettlementFailureStatus) : null,
              });
            }}
          />
        </label>
        {error ? (
          <Alert
            showIcon
            type="error"
            message={t(
              'admin.payments.settlements.loadFailed',
              'Unable to load credit settlement failures',
            )}
          />
        ) : null}
        <InlineTable
          columns={columns as TableProps['columns']}
          dataSource={data?.items ?? []}
          loading={isLoading}
          rowKey="id"
        />
        {(cursor > 0 || data?.nextCursor != null) && (
          <Space>
            <Button
              disabled={cursor === 0}
              onClick={() => updateParams({ settlementCursor: Math.max(0, cursor - PAGE_SIZE) })}
            >
              {t('admin.pagination.previous', 'Previous')}
            </Button>
            <Button
              disabled={data?.nextCursor == null}
              onClick={() => updateParams({ settlementCursor: data?.nextCursor ?? null })}
            >
              {t('admin.pagination.next', 'Next')}
            </Button>
          </Space>
        )}
      </section>
    );
  },
);

CreditSettlementFailuresPage.displayName = 'CreditSettlementFailuresPage';

export default CreditSettlementFailuresPage;
