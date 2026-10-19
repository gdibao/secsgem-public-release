'use client';

import {
  ADMIN_CAPABILITIES,
  hasAdminCapability,
  type PaymentMethodId,
  type PaymentProvider,
} from '@lobechat/types';
import { Button, Input, Modal, Select, TextArea, toast } from '@lobehub/ui/base-ui';
import { Alert, Space, type TableProps, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import InlineTable from '@/components/InlineTable';
import { formatAdminCredits } from '@/features/Admin/adminCreditUnits';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import PendingRefundResolutionModal, {
  type PendingRefundResolution,
} from './PendingRefundResolutionModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  controls: css`
    display: grid;
    grid-template-columns:
      repeat(2, minmax(160px, 220px)) minmax(220px, 1fr) minmax(220px, 1fr)
      auto;
    gap: 8px;
    align-items: end;

    @media (width <= 960px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  field: css`
    display: grid;
    gap: 6px;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  page: css`
    display: grid;
    gap: 16px;
    min-width: 0;
  `,
  refundForm: css`
    display: grid;
    gap: 8px;
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
  `,
}));

const ONLINE_PAYMENT_PROVIDERS = [
  'alipay',
  'wechat_pay',
  'zpay',
] as const satisfies readonly PaymentProvider[];
const TOP_UP_PAYMENT_STATUSES = [
  'pending',
  'paid',
  'canceled',
  'expired',
  'failed',
  'refunded',
] as const;

type TopUpPaymentStatus = (typeof TOP_UP_PAYMENT_STATUSES)[number];

type TopUpPaymentRow = {
  amount: number | string;
  createdAt: Date | string;
  credits: number | string;
  currency: string;
  externalOrderId: null | string;
  id: string;
  idempotencyKey: null | string;
  method: null | PaymentMethodId;
  packageId: null | string;
  paidAt: Date | null | string;
  paymentReference: null | string;
  provider: PaymentProvider;
  refundReference: null | string;
  refundStatus: 'failed' | 'pending' | 'succeeded' | null;
  status: TopUpPaymentStatus;
  updatedAt: Date | string;
  userEmail: null | string;
  userId: string;
  userName: null | string;
};

type TopUpPaymentListResponse = {
  items: TopUpPaymentRow[];
  nextCursor: null | number;
};

type PendingReconciliationResponse = {
  count: number;
  failedCount: number;
  results: Array<{ ok: boolean; orderId: string }>;
};

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

const parseSearchParam = <T extends string>(value: null | string, allowed: readonly T[]) =>
  value && allowed.includes(value as T) ? (value as T) : undefined;

const statusColor: Record<TopUpPaymentStatus, string> = {
  canceled: 'default',
  expired: 'orange',
  failed: 'red',
  paid: 'green',
  pending: 'blue',
  refunded: 'purple',
};

const TopUpPaymentsPage = memo<{ canWrite?: boolean }>(({ canWrite: canWriteOverride }) => {
  const { t } = useTranslation('subscription');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = canWriteOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const cursorValue = Number(searchParams.get('cursor') ?? 0);
  const cursor = Number.isInteger(cursorValue) && cursorValue >= 0 ? cursorValue : 0;
  const orderIdParam = searchParams.get('orderId') ?? '';
  const orderId = UUID_PATTERN.test(orderIdParam) ? orderIdParam : '';
  const provider = parseSearchParam(searchParams.get('provider'), ONLINE_PAYMENT_PROVIDERS);
  const status = parseSearchParam(searchParams.get('status'), TOP_UP_PAYMENT_STATUSES);
  const userId = searchParams.get('userId') ?? '';
  const [orderDraft, setOrderDraft] = useState(orderIdParam);
  const [userDraft, setUserDraft] = useState(userId);
  const [filterError, setFilterError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [refundOrder, setRefundOrder] = useState<TopUpPaymentRow>();
  const [refundReason, setRefundReason] = useState('');
  const [resolutionOrder, setResolutionOrder] = useState<TopUpPaymentRow>();
  const [resolution, setResolution] = useState<PendingRefundResolution>();
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => setOrderDraft(orderIdParam), [orderIdParam]);
  useEffect(() => setUserDraft(userId), [userId]);

  const swrKey = useMemo(
    () => ['admin-top-up-payments', cursor, orderId, provider, status, userId] as const,
    [cursor, orderId, provider, status, userId],
  );
  const { data, error, isLoading } = useClientDataSWR<TopUpPaymentListResponse>(
    swrKey,
    () =>
      adminCommercialService.listTopUpPayments({
        cursor,
        limit: 25,
        orderId: orderId || undefined,
        provider: provider || undefined,
        status: status || undefined,
        userId: userId || undefined,
      }) as Promise<TopUpPaymentListResponse>,
  );

  const updateParams = (updates: Record<string, null | string>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      next.delete('cursor');
      return next;
    });
  };

  const applyTextFilters = () => {
    const normalizedOrderId = orderDraft.trim();
    if (normalizedOrderId && !UUID_PATTERN.test(normalizedOrderId)) {
      setFilterError(t('admin.payments.topups.invalidOrderId', 'Enter a complete order UUID'));
      return;
    }
    setFilterError(undefined);
    updateParams({ orderId: normalizedOrderId || null, userId: userDraft.trim() || null });
  };

  const clearFilters = () => {
    setFilterError(undefined);
    setOrderDraft('');
    setUserDraft('');
    updateParams({ orderId: null, provider: null, status: null, userId: null });
  };

  const runReconciliation = async <T,>(
    key: string,
    operation: () => Promise<T>,
    onSuccess?: (result: T) => void,
  ) => {
    setBusyAction(key);
    try {
      const result = await operation();
      await mutate(swrKey);
      if (onSuccess) onSuccess(result);
      else toast.success(t('admin.payments.topups.reconcileSuccess', 'Payment status refreshed'));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t('admin.payments.topups.reconcileFailed', 'Unable to refresh payment status'),
      );
    } finally {
      setBusyAction(undefined);
    }
  };

  const closeRefund = () => {
    if (busyAction?.startsWith('refund:')) return;
    setRefundOrder(undefined);
    setRefundReason('');
  };

  const submitRefund = async () => {
    if (!refundOrder || !refundReason.trim()) return;
    await runReconciliation(
      `refund:${refundOrder.id}`,
      () =>
        adminCommercialService.refundTopUpPayment({
          orderId: refundOrder.id,
          reason: refundReason.trim(),
        }),
      (result: { debtAmount?: number; status: string }) => {
        if (result.status === 'pending') {
          toast.warning(
            t(
              'admin.payments.topups.refundPending',
              'The provider is still processing this refund. Reconcile or retry later.',
            ),
          );
        } else {
          toast.success(t('admin.payments.topups.refundSuccess', 'Refund completed'));
        }
        setRefundOrder(undefined);
        setRefundReason('');
      },
    );
  };

  const closeResolution = () => {
    if (busyAction?.startsWith('resolve:')) return;
    setResolutionOrder(undefined);
    setResolution(undefined);
    setResolutionNote('');
  };

  const submitResolution = async () => {
    if (!resolutionOrder || !resolution || !resolutionNote.trim()) return;
    await runReconciliation(
      `resolve:${resolutionOrder.id}`,
      () =>
        adminCommercialService.resolveTopUpPaymentRefund({
          note: resolutionNote.trim(),
          orderId: resolutionOrder.id,
          resolution,
        }),
      () => {
        if (resolution === 'failed') {
          toast.warning(
            t(
              'admin.payments.topups.manualResolution.retryEnabled',
              'Marked as not refunded. A new refund attempt is now allowed.',
            ),
          );
        } else {
          toast.success(
            t(
              'admin.payments.topups.manualResolution.completed',
              'Refund confirmation applied and local balances were updated.',
            ),
          );
        }
        closeResolution();
      },
    );
  };

  const columns = [
    {
      dataIndex: 'id',
      key: 'id',
      render: (value: string) => <code title={value}>{value.slice(0, 12)}</code>,
      title: t('admin.payments.topups.columns.order', 'Order'),
    },
    {
      dataIndex: 'userId',
      key: 'user',
      render: (value: string, row: TopUpPaymentRow) => (
        <div>
          <div>{row.userEmail || row.userName || '-'}</div>
          <code title={value}>{value.slice(0, 12)}</code>
        </div>
      ),
      title: t('admin.payments.topups.columns.user', 'User'),
    },
    {
      key: 'channel',
      render: (_: unknown, row: TopUpPaymentRow) => (
        <div>
          <div>{row.provider}</div>
          <small>{row.method || '-'}</small>
        </div>
      ),
      title: t('admin.payments.topups.columns.channel', 'Channel'),
    },
    {
      key: 'amount',
      render: (_: unknown, row: TopUpPaymentRow) => (
        <div>
          <div>{`${row.currency} ${row.amount}`}</div>
          <small>{formatAdminCredits(row.credits)}</small>
        </div>
      ),
      title: t('admin.payments.topups.columns.amount', 'Amount / credits'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (value: TopUpPaymentStatus, row: TopUpPaymentRow) => (
        <Space direction="vertical" size={2}>
          <Tag color={statusColor[value]}>{t(`admin.payments.topups.status.${value}`, value)}</Tag>
          {row.refundStatus && value !== 'refunded' ? (
            <small>
              {t(
                `admin.payments.topups.refundStatus.${row.refundStatus}`,
                `Refund ${row.refundStatus}`,
              )}
            </small>
          ) : null}
        </Space>
      ),
      title: t('admin.payments.topups.columns.status', 'Status'),
    },
    {
      dataIndex: 'externalOrderId',
      key: 'externalOrderId',
      render: (value: null | string) => (value ? <code title={value}>{value}</code> : '-'),
      title: t('admin.payments.topups.columns.providerOrder', 'Provider order'),
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: Date | string) => new Date(value).toLocaleString(),
      title: t('admin.payments.topups.columns.createdAt', 'Created'),
      width: 180,
    },
    {
      key: 'actions',
      render: (_: unknown, row: TopUpPaymentRow) => {
        if (!canWrite) return '-';
        const canReconcile =
          ['expired', 'failed', 'pending'].includes(row.status) ||
          (row.status === 'canceled' && ['failed', 'pending'].includes(row.refundStatus ?? ''));
        const canRefund =
          row.status === 'paid' &&
          row.refundStatus !== 'pending' &&
          row.refundStatus !== 'succeeded';
        const canResolveRefund = row.provider === 'zpay' && row.refundStatus === 'pending';
        if (!canReconcile && !canRefund && !canResolveRefund) return '-';
        return (
          <Space wrap size={4}>
            {canReconcile ? (
              <Button
                loading={busyAction === row.id}
                size="small"
                onClick={() =>
                  runReconciliation(row.id, () =>
                    adminCommercialService.reconcileTopUpPayment(row.id),
                  )
                }
              >
                {t('admin.payments.topups.reconcile', 'Reconcile')}
              </Button>
            ) : null}
            {canRefund ? (
              <Button
                icon={<RotateCcw aria-hidden size={14} />}
                loading={busyAction === `refund:${row.id}`}
                size="small"
                onClick={() => setRefundOrder(row)}
              >
                {t('admin.payments.topups.refund', 'Refund')}
              </Button>
            ) : null}
            {canResolveRefund ? (
              <Button
                icon={<ShieldCheck aria-hidden size={14} />}
                loading={busyAction === `resolve:${row.id}`}
                size="small"
                onClick={() => setResolutionOrder(row)}
              >
                {t('admin.payments.topups.manualResolution.action', 'Verify refund')}
              </Button>
            ) : null}
          </Space>
        );
      },
      title: t('admin.actions', 'Actions'),
      width: 190,
    },
  ];

  return (
    <section className={styles.page} data-testid="top-up-payments-page">
      <div className={styles.toolbar}>
        <div>
          <strong>{t('admin.payments.topups.title', 'Top-up transactions')}</strong>
          <div>
            {t(
              'admin.payments.topups.description',
              'Review online top-ups and query providers for their latest status.',
            )}
          </div>
        </div>
        <Space wrap>
          <Button icon={<RefreshCw aria-hidden size={16} />} onClick={() => mutate(swrKey)}>
            {t('admin.payments.topups.refresh', 'Refresh list')}
          </Button>
          {canWrite ? (
            <Button
              loading={busyAction === 'pending'}
              type="primary"
              onClick={() =>
                runReconciliation(
                  'pending',
                  () =>
                    adminCommercialService.reconcilePendingTopUpPayments(
                      100,
                    ) as Promise<PendingReconciliationResponse>,
                  (result) => {
                    if (result.failedCount > 0) {
                      toast.warning(
                        t('admin.payments.topups.reconcilePartial', {
                          defaultValue:
                            '{{failed}} of {{total}} payments could not be refreshed. Review the failed rows and retry.',
                          failed: result.failedCount,
                          total: result.count,
                        }),
                      );
                      return;
                    }
                    toast.success(
                      t('admin.payments.topups.reconcileSuccess', 'Payment status refreshed'),
                    );
                  },
                )
              }
            >
              {t('admin.payments.topups.reconcilePending', 'Reconcile pending')}
            </Button>
          ) : null}
        </Space>
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          {t('admin.payments.topups.filters.status', 'Status')}
          <Select
            value={status ?? ''}
            options={['', ...TOP_UP_PAYMENT_STATUSES].map((value) => ({
              label: value
                ? t(`admin.payments.topups.status.${value}`, value)
                : t('admin.payments.topups.filters.all', 'All'),
              value,
            }))}
            onChange={(value) => updateParams({ status: String(value || '') || null })}
          />
        </label>
        <label className={styles.field}>
          {t('admin.payments.topups.filters.provider', 'Provider')}
          <Select
            value={provider ?? ''}
            options={[
              { label: t('admin.payments.topups.filters.all', 'All'), value: '' },
              { label: t('admin.payments.provider.alipay', 'Alipay'), value: 'alipay' },
              { label: t('admin.payments.provider.wechat', 'WeChat Pay'), value: 'wechat_pay' },
              { label: t('admin.payments.provider.zpay', 'Z-Pay'), value: 'zpay' },
            ]}
            onChange={(value) => updateParams({ provider: String(value || '') || null })}
          />
        </label>
        <label className={styles.field}>
          {t('admin.payments.topups.filters.orderId', 'Order ID')}
          <Input value={orderDraft} onChange={(event) => setOrderDraft(event.target.value)} />
        </label>
        <label className={styles.field}>
          {t('admin.payments.topups.filters.userId', 'User ID')}
          <Input value={userDraft} onChange={(event) => setUserDraft(event.target.value)} />
        </label>
        <Space>
          <Button icon={<Search aria-hidden size={16} />} onClick={applyTextFilters}>
            {t('admin.payments.topups.filters.apply', 'Apply')}
          </Button>
          <Button onClick={clearFilters}>
            {t('admin.payments.topups.filters.clear', 'Clear')}
          </Button>
        </Space>
      </div>

      {filterError ? <Alert showIcon message={filterError} type="warning" /> : null}
      {error ? (
        <Alert
          showIcon
          message={t('admin.payments.topups.loadFailed', 'Unable to load top-up transactions')}
          type="error"
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
            onClick={() =>
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                const previous = Math.max(0, cursor - 25);
                if (previous) next.set('cursor', String(previous));
                else next.delete('cursor');
                return next;
              })
            }
          >
            {t('admin.pagination.previous', 'Previous')}
          </Button>
          <Button
            disabled={data?.nextCursor == null}
            onClick={() =>
              data?.nextCursor != null &&
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.set('cursor', String(data.nextCursor));
                return next;
              })
            }
          >
            {t('admin.pagination.next', 'Next')}
          </Button>
        </Space>
      )}
      <Modal
        cancelText={t('cancel', 'Cancel')}
        confirmLoading={Boolean(busyAction?.startsWith('refund:'))}
        okButtonProps={{ disabled: !refundReason.trim() }}
        okText={t('admin.payments.topups.confirmRefund', 'Confirm refund')}
        open={Boolean(refundOrder)}
        title={t('admin.payments.topups.refundTitle', 'Refund top-up payment')}
        onCancel={closeRefund}
        onOk={submitRefund}
      >
        <div className={styles.refundForm}>
          <div>
            {refundOrder
              ? `${refundOrder.currency} ${refundOrder.amount} · ${refundOrder.id}`
              : null}
          </div>
          <label>
            {t('admin.payments.topups.refundReason', 'Refund reason')}
            <TextArea
              required
              maxLength={500}
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
            />
          </label>
        </div>
      </Modal>
      <PendingRefundResolutionModal
        busy={Boolean(busyAction?.startsWith('resolve:'))}
        note={resolutionNote}
        open={Boolean(resolutionOrder)}
        resolution={resolution}
        title={t('admin.payments.topups.manualResolution.title', 'Verify pending refund')}
        labels={{
          cancel: t('cancel', 'Cancel'),
          chooseOutcome: t(
            'admin.payments.topups.manualResolution.chooseOutcome',
            'Choose the provider outcome',
          ),
          confirm: t('admin.payments.topups.manualResolution.confirm', 'Apply decision'),
          description: t(
            'admin.payments.topups.manualResolution.description',
            'Check the Z-Pay merchant portal before deciding. An incorrect decision can duplicate a refund or leave credits unreversed.',
          ),
          note: t('admin.payments.topups.manualResolution.note', 'Verification note'),
          notRefunded: t(
            'admin.payments.topups.manualResolution.notRefunded',
            'Not refunded - allow retry',
          ),
          outcome: t('admin.payments.topups.manualResolution.outcome', 'Provider outcome'),
          refunded: t(
            'admin.payments.topups.manualResolution.refunded',
            'Refunded - reverse credits',
          ),
        }}
        summary={
          resolutionOrder
            ? `${resolutionOrder.currency} ${resolutionOrder.amount} · ${resolutionOrder.id}`
            : ''
        }
        onCancel={closeResolution}
        onConfirm={submitResolution}
        onNoteChange={setResolutionNote}
        onResolutionChange={setResolution}
      />
    </section>
  );
});

TopUpPaymentsPage.displayName = 'TopUpPaymentsPage';

export default TopUpPaymentsPage;
