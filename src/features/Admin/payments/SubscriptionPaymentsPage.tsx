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

const PAYMENT_PROVIDERS = [
  'alipay',
  'wechat_pay',
  'zpay',
] as const satisfies readonly PaymentProvider[];
const PAYMENT_STATUSES = ['pending', 'paid', 'canceled', 'expired', 'failed', 'refunded'] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

type SubscriptionPaymentRow = {
  amount: number | string;
  createdAt: Date | string;
  currency: string;
  cycle: string;
  displayName: string;
  externalOrderId: null | string;
  id: string;
  idempotencyKey: string;
  method: PaymentMethodId;
  monthlyCredits: number | string;
  paidAt: Date | null | string;
  plan: string;
  provider: PaymentProvider;
  refundReference: null | string;
  refundStatus: 'failed' | 'pending' | 'succeeded' | null;
  status: PaymentStatus;
  updatedAt: Date | string;
  userEmail: null | string;
  userId: string;
  userName: null | string;
};

type SubscriptionPaymentListResponse = {
  items: SubscriptionPaymentRow[];
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

const statusColor: Record<PaymentStatus, string> = {
  canceled: 'default',
  expired: 'orange',
  failed: 'red',
  paid: 'green',
  pending: 'blue',
  refunded: 'purple',
};

const SubscriptionPaymentsPage = memo<{ canWrite?: boolean }>(({ canWrite: canWriteOverride }) => {
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
  const provider = parseSearchParam(searchParams.get('provider'), PAYMENT_PROVIDERS);
  const status = parseSearchParam(searchParams.get('status'), PAYMENT_STATUSES);
  const userId = searchParams.get('userId') ?? '';
  const [orderDraft, setOrderDraft] = useState(orderIdParam);
  const [userDraft, setUserDraft] = useState(userId);
  const [filterError, setFilterError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [refundOrder, setRefundOrder] = useState<SubscriptionPaymentRow>();
  const [refundReason, setRefundReason] = useState('');
  const [resolutionOrder, setResolutionOrder] = useState<SubscriptionPaymentRow>();
  const [resolution, setResolution] = useState<PendingRefundResolution>();
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => setOrderDraft(orderIdParam), [orderIdParam]);
  useEffect(() => setUserDraft(userId), [userId]);

  const swrKey = useMemo(
    () => ['admin-subscription-payments', cursor, orderId, provider, status, userId] as const,
    [cursor, orderId, provider, status, userId],
  );
  const { data, error, isLoading } = useClientDataSWR<SubscriptionPaymentListResponse>(
    swrKey,
    () =>
      adminCommercialService.listSubscriptionPayments({
        cursor,
        limit: 25,
        orderId: orderId || undefined,
        provider: provider || undefined,
        status: status || undefined,
        userId: userId || undefined,
      }) as Promise<SubscriptionPaymentListResponse>,
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
      setFilterError(
        t('admin.payments.subscriptions.invalidOrderId', 'Enter a complete order UUID'),
      );
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

  const runOperation = async <T,>(
    key: string,
    operation: () => Promise<T>,
    onSuccess?: (result: T) => void,
  ) => {
    setBusyAction(key);
    try {
      const result = await operation();
      await mutate(swrKey);
      if (onSuccess) onSuccess(result);
      else {
        toast.success(
          t('admin.payments.subscriptions.reconcileSuccess', 'Payment status refreshed'),
        );
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t('admin.payments.subscriptions.reconcileFailed', 'Unable to refresh payment status'),
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
    await runOperation(
      `refund:${refundOrder.id}`,
      () =>
        adminCommercialService.refundSubscriptionPayment({
          orderId: refundOrder.id,
          reason: refundReason.trim(),
        }),
      (result: { debtAmount?: number; status: string }) => {
        if (result.status === 'pending') {
          toast.warning(
            t(
              'admin.payments.subscriptions.refundPending',
              'The provider is still processing this refund. Reconcile or retry later.',
            ),
          );
        } else {
          toast.success(t('admin.payments.subscriptions.refundSuccess', 'Refund completed'));
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
    await runOperation(
      `resolve:${resolutionOrder.id}`,
      () =>
        adminCommercialService.resolveSubscriptionPaymentRefund({
          note: resolutionNote.trim(),
          orderId: resolutionOrder.id,
          resolution,
        }),
      () => {
        if (resolution === 'failed') {
          toast.warning(
            t(
              'admin.payments.subscriptions.manualResolution.retryEnabled',
              'Marked as not refunded. A new refund attempt is now allowed.',
            ),
          );
        } else {
          toast.success(
            t(
              'admin.payments.subscriptions.manualResolution.completed',
              'Refund confirmation applied and plan benefits were reversed.',
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
      title: t('admin.payments.subscriptions.columns.order', 'Order'),
    },
    {
      dataIndex: 'userId',
      key: 'user',
      render: (value: string, row: SubscriptionPaymentRow) => (
        <div>
          <div>{row.userEmail || row.userName || '-'}</div>
          <code title={value}>{value.slice(0, 12)}</code>
        </div>
      ),
      title: t('admin.payments.subscriptions.columns.user', 'User'),
    },
    {
      key: 'plan',
      render: (_: unknown, row: SubscriptionPaymentRow) => (
        <div>
          <div>{row.displayName || row.plan}</div>
          <small>{`${row.cycle} · ${formatAdminCredits(row.monthlyCredits)}`}</small>
        </div>
      ),
      title: t('admin.payments.subscriptions.columns.plan', 'Plan / cycle'),
    },
    {
      key: 'channel',
      render: (_: unknown, row: SubscriptionPaymentRow) => (
        <div>
          <div>{row.provider}</div>
          <small>{row.method}</small>
        </div>
      ),
      title: t('admin.payments.subscriptions.columns.channel', 'Channel'),
    },
    {
      key: 'amount',
      render: (_: unknown, row: SubscriptionPaymentRow) => `${row.currency} ${row.amount}`,
      title: t('admin.payments.subscriptions.columns.amount', 'Amount'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (value: PaymentStatus, row: SubscriptionPaymentRow) => (
        <Space direction="vertical" size={2}>
          <Tag color={statusColor[value]}>
            {t(`admin.payments.subscriptions.status.${value}`, value)}
          </Tag>
          {row.refundStatus && value !== 'refunded' ? (
            <small>
              {t(
                `admin.payments.subscriptions.refundStatus.${row.refundStatus}`,
                `Refund ${row.refundStatus}`,
              )}
            </small>
          ) : null}
        </Space>
      ),
      title: t('admin.payments.subscriptions.columns.status', 'Status'),
    },
    {
      dataIndex: 'externalOrderId',
      key: 'externalOrderId',
      render: (value: null | string) => (value ? <code title={value}>{value}</code> : '-'),
      title: t('admin.payments.subscriptions.columns.providerOrder', 'Provider order'),
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: Date | string) => new Date(value).toLocaleString(),
      title: t('admin.payments.subscriptions.columns.createdAt', 'Created'),
      width: 180,
    },
    {
      key: 'actions',
      render: (_: unknown, row: SubscriptionPaymentRow) => {
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
                  runOperation(row.id, () =>
                    adminCommercialService.reconcileSubscriptionPayment(row.id),
                  )
                }
              >
                {t('admin.payments.subscriptions.reconcile', 'Reconcile')}
              </Button>
            ) : null}
            {canRefund ? (
              <Button
                icon={<RotateCcw aria-hidden size={14} />}
                loading={busyAction === `refund:${row.id}`}
                size="small"
                onClick={() => setRefundOrder(row)}
              >
                {t('admin.payments.subscriptions.refund', 'Refund')}
              </Button>
            ) : null}
            {canResolveRefund ? (
              <Button
                icon={<ShieldCheck aria-hidden size={14} />}
                loading={busyAction === `resolve:${row.id}`}
                size="small"
                onClick={() => setResolutionOrder(row)}
              >
                {t('admin.payments.subscriptions.manualResolution.action', 'Verify refund')}
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
    <section className={styles.page} data-testid="subscription-payments-page">
      <div className={styles.toolbar}>
        <div>
          <strong>{t('admin.payments.subscriptions.title', 'Plan payment transactions')}</strong>
          <div>
            {t(
              'admin.payments.subscriptions.description',
              'Review plan purchases, reconcile provider state, and process full refunds.',
            )}
          </div>
        </div>
        <Space wrap>
          <Button icon={<RefreshCw aria-hidden size={16} />} onClick={() => mutate(swrKey)}>
            {t('admin.payments.subscriptions.refresh', 'Refresh list')}
          </Button>
          {canWrite ? (
            <Button
              loading={busyAction === 'pending'}
              type="primary"
              onClick={() =>
                runOperation(
                  'pending',
                  () =>
                    adminCommercialService.reconcilePendingSubscriptionPayments(
                      100,
                    ) as Promise<PendingReconciliationResponse>,
                  (result) => {
                    if (result.failedCount > 0) {
                      toast.warning(
                        t('admin.payments.subscriptions.reconcilePartial', {
                          defaultValue:
                            '{{failed}} of {{total}} payments could not be refreshed. Review the failed rows and retry.',
                          failed: result.failedCount,
                          total: result.count,
                        }),
                      );
                    } else {
                      toast.success(
                        t(
                          'admin.payments.subscriptions.reconcileSuccess',
                          'Payment status refreshed',
                        ),
                      );
                    }
                  },
                )
              }
            >
              {t('admin.payments.subscriptions.reconcilePending', 'Reconcile pending')}
            </Button>
          ) : null}
        </Space>
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          {t('admin.payments.subscriptions.filters.status', 'Status')}
          <Select
            value={status ?? ''}
            options={['', ...PAYMENT_STATUSES].map((value) => ({
              label: value
                ? t(`admin.payments.subscriptions.status.${value}`, value)
                : t('admin.payments.subscriptions.filters.all', 'All'),
              value,
            }))}
            onChange={(value) => updateParams({ status: String(value || '') || null })}
          />
        </label>
        <label className={styles.field}>
          {t('admin.payments.subscriptions.filters.provider', 'Provider')}
          <Select
            value={provider ?? ''}
            options={[
              { label: t('admin.payments.subscriptions.filters.all', 'All'), value: '' },
              { label: t('admin.payments.provider.alipay', 'Alipay'), value: 'alipay' },
              { label: t('admin.payments.provider.wechat', 'WeChat Pay'), value: 'wechat_pay' },
              { label: t('admin.payments.provider.zpay', 'Z-Pay'), value: 'zpay' },
            ]}
            onChange={(value) => updateParams({ provider: String(value || '') || null })}
          />
        </label>
        <label className={styles.field}>
          {t('admin.payments.subscriptions.filters.orderId', 'Order ID')}
          <Input value={orderDraft} onChange={(event) => setOrderDraft(event.target.value)} />
        </label>
        <label className={styles.field}>
          {t('admin.payments.subscriptions.filters.userId', 'User ID')}
          <Input value={userDraft} onChange={(event) => setUserDraft(event.target.value)} />
        </label>
        <Space>
          <Button icon={<Search aria-hidden size={16} />} onClick={applyTextFilters}>
            {t('admin.payments.subscriptions.filters.apply', 'Apply')}
          </Button>
          <Button onClick={clearFilters}>
            {t('admin.payments.subscriptions.filters.clear', 'Clear')}
          </Button>
        </Space>
      </div>

      {filterError ? <Alert showIcon message={filterError} type="warning" /> : null}
      {error ? (
        <Alert
          showIcon
          type="error"
          message={t(
            'admin.payments.subscriptions.loadFailed',
            'Unable to load plan payment transactions',
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
        okText={t('admin.payments.subscriptions.confirmRefund', 'Confirm refund')}
        open={Boolean(refundOrder)}
        title={t('admin.payments.subscriptions.refundTitle', 'Refund plan payment')}
        onCancel={closeRefund}
        onOk={submitRefund}
      >
        <div className={styles.refundForm}>
          <div>
            {refundOrder
              ? `${refundOrder.currency} ${refundOrder.amount} · ${refundOrder.displayName}`
              : null}
          </div>
          <label>
            {t('admin.payments.subscriptions.refundReason', 'Refund reason')}
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
        title={t('admin.payments.subscriptions.manualResolution.title', 'Verify pending refund')}
        labels={{
          cancel: t('cancel', 'Cancel'),
          chooseOutcome: t(
            'admin.payments.subscriptions.manualResolution.chooseOutcome',
            'Choose the provider outcome',
          ),
          confirm: t('admin.payments.subscriptions.manualResolution.confirm', 'Apply decision'),
          description: t(
            'admin.payments.subscriptions.manualResolution.description',
            'Check the Z-Pay merchant portal before deciding. An incorrect decision can duplicate a refund or leave plan benefits active.',
          ),
          note: t('admin.payments.subscriptions.manualResolution.note', 'Verification note'),
          notRefunded: t(
            'admin.payments.subscriptions.manualResolution.notRefunded',
            'Not refunded - allow retry',
          ),
          outcome: t('admin.payments.subscriptions.manualResolution.outcome', 'Provider outcome'),
          refunded: t(
            'admin.payments.subscriptions.manualResolution.refunded',
            'Refunded - reverse benefits',
          ),
        }}
        summary={
          resolutionOrder
            ? `${resolutionOrder.currency} ${resolutionOrder.amount} · ${resolutionOrder.displayName}`
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

SubscriptionPaymentsPage.displayName = 'SubscriptionPaymentsPage';

export default SubscriptionPaymentsPage;
