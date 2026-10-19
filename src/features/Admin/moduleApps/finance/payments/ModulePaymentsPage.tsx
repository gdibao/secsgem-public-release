'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, Input, Modal, Select, TextArea, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Download, RefreshCw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import PendingRefundResolutionModal, {
  type PendingRefundResolution,
} from '../../../payments/PendingRefundResolutionModal';
import CursorPager from '../../CursorPager';
import PaymentReconciliationTable, {
  type ModuleAppPaymentDiagnosticRow,
} from '../../PaymentReconciliationTable';
import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import ModulePageState from '../../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../../shared/queryState';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  form: css`
    display: grid;
    gap: 12px;
  `,
  page: css`
    display: grid;
    gap: 16px;
    max-width: 1180px;
  `,
}));

type PaymentListResponse = {
  items: ModuleAppPaymentDiagnosticRow[];
  nextCursor: null | string;
};
type PaymentStatus = 'created' | 'failed' | 'paid' | 'pending' | 'refunded';
type RefundStatus = 'failed' | 'requested' | 'succeeded';
type DiscrepancyStatus = 'open' | 'resolved';
type PaymentFormAction = 'offlineRefund' | 'refund' | 'settle';
type ModulePaymentsPageProps = { canWrite?: boolean; embedded?: boolean };

const downloadJson = (value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.download = `module-payment-discrepancies-${new Date().toISOString()}.json`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
};

const ModulePaymentsPage = memo<ModulePaymentsPageProps>((props) => {
  const { canWrite: canWriteOverride, embedded = false } = props;
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = canWriteOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const [action, setAction] = useState<PaymentFormAction>();
  const [actionError, setActionError] = useState<string>();
  const [actionTarget, setActionTarget] = useState<ModuleAppPaymentDiagnosticRow>();
  const [busyAction, setBusyAction] = useState<string>();
  const [offlineRefundReference, setOfflineRefundReference] = useState('');
  const [operationResult, setOperationResult] = useState<string>();
  const [paymentReference, setPaymentReference] = useState('');
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<PendingRefundResolution>();
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionTarget, setResolutionTarget] = useState<ModuleAppPaymentDiagnosticRow>();
  const [submitting, setSubmitting] = useState(false);
  const paymentStatus = searchParams.get('paymentStatus') ?? undefined;
  const refundStatus = searchParams.get('refundStatus') ?? undefined;
  const discrepancyStatus = searchParams.get('discrepancyStatus') ?? undefined;
  const appId = searchParams.get('appId') ?? undefined;
  const orderId = searchParams.get('orderId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const filters = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('cursor');
    next.delete('previousCursor');
    return next.toString();
  }, [searchParams]);
  const listKey = moduleAppCacheKeys.payments(filters, cursor);
  const { data, error, isLoading } = useClientDataSWR<PaymentListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listPaymentDiagnostics({
        appId,
        cursor,
        discrepancyStatus: discrepancyStatus as DiscrepancyStatus | undefined,
        limit: 25,
        orderId,
        paymentStatus: paymentStatus as PaymentStatus | undefined,
        refundStatus: refundStatus as RefundStatus | undefined,
      }) as Promise<PaymentListResponse>,
  );
  const updateFilter = (name: string, value: string) =>
    setSearchParams((current) => setFilter(current, name, value || undefined));
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    [
      'paymentStatus',
      'refundStatus',
      'discrepancyStatus',
      'appId',
      'orderId',
      'cursor',
      'previousCursor',
    ].forEach((key) => next.delete(key));
    setSearchParams(next);
  };
  const isFiltered = Boolean(
    paymentStatus || refundStatus || discrepancyStatus || appId || orderId || cursor,
  );
  const statusLabels = {
    created: t('moduleApps.admin.finance.status.created'),
    failed: t('moduleApps.admin.finance.status.failed'),
    open: t('moduleApps.admin.finance.status.open'),
    paid: t('moduleApps.admin.finance.status.paid'),
    pending: t('moduleApps.admin.finance.status.pending'),
    refunded: t('moduleApps.admin.finance.status.refunded'),
    requested: t('moduleApps.admin.finance.status.requested'),
    resolved: t('moduleApps.admin.finance.status.resolved'),
    succeeded: t('moduleApps.admin.finance.status.succeeded'),
  };
  const runDirectAction = async (name: string, operation: () => Promise<unknown>) => {
    setBusyAction(name);
    setOperationResult(undefined);
    try {
      const result = await operation();
      await mutate(listKey);
      setOperationResult(t('moduleApps.admin.payments.operationSuccess'));
      return result;
    } catch (cause) {
      setOperationResult(
        cause instanceof Error ? cause.message : t('moduleApps.admin.payments.operationError'),
      );
    } finally {
      setBusyAction(undefined);
    }
  };
  const openAction = (nextAction: PaymentFormAction, row: ModuleAppPaymentDiagnosticRow) => {
    setAction(nextAction);
    setActionError(undefined);
    setActionTarget(row);
    setOfflineRefundReference('');
    setPaymentReference('');
    setReason('');
  };
  const closeAction = () => {
    if (submitting) return;
    setAction(undefined);
    setActionTarget(undefined);
  };
  const submitAction = async () => {
    if (!action || !actionTarget) return;
    if (action !== 'settle' && !reason.trim()) return;
    if (action === 'offlineRefund' && !offlineRefundReference.trim()) return;
    if (action === 'settle' && !paymentReference.trim()) return;
    setSubmitting(true);
    setActionError(undefined);
    try {
      if (action === 'refund') {
        await adminCommercialService.moduleApps.refundPaymentOrder({
          orderId: actionTarget.orderId,
          reason: reason.trim(),
        });
      } else if (action === 'offlineRefund') {
        await adminCommercialService.moduleApps.refundOrder({
          offlineRefundReference: offlineRefundReference.trim(),
          orderId: actionTarget.orderId,
          reason: reason.trim(),
        });
      } else {
        await adminCommercialService.moduleApps.settleOrder({
          orderId: actionTarget.orderId,
          paymentReference: paymentReference.trim(),
        });
      }
      await mutate(listKey);
      toast.success(t('moduleApps.admin.payments.operationSuccess'));
      setAction(undefined);
      setActionTarget(undefined);
      setOfflineRefundReference('');
      setPaymentReference('');
      setReason('');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : t('moduleApps.admin.payments.operationError'),
      );
    } finally {
      setSubmitting(false);
    }
  };
  const exportDiscrepancies = async () => {
    setBusyAction('export');
    setOperationResult(undefined);
    try {
      const numericCursor = cursor === undefined ? undefined : Number(cursor);
      const result = await adminCommercialService.moduleApps.exportPaymentReconciliation({
        cursor: Number.isFinite(numericCursor) ? numericCursor : undefined,
        limit: 500,
        status: discrepancyStatus as DiscrepancyStatus | undefined,
      });
      downloadJson(result);
      setOperationResult(t('moduleApps.admin.payments.exportSuccess'));
    } catch (cause) {
      setOperationResult(
        cause instanceof Error ? cause.message : t('moduleApps.admin.payments.operationError'),
      );
    } finally {
      setBusyAction(undefined);
    }
  };
  const closeResolution = () => {
    if (busyAction?.startsWith('resolve:')) return;
    setResolutionTarget(undefined);
    setResolution(undefined);
    setResolutionNote('');
  };
  const submitResolution = async () => {
    if (!resolutionTarget || !resolution || !resolutionNote.trim()) return;
    const result = await runDirectAction(`resolve:${resolutionTarget.orderId}`, () =>
      adminCommercialService.moduleApps.resolvePaymentRefund({
        note: resolutionNote.trim(),
        orderId: resolutionTarget.orderId,
        resolution,
      }),
    );
    if (result) {
      toast.success(t('moduleApps.admin.payments.manualResolution.operationSuccess'));
      closeResolution();
    }
  };
  const actionIsValid =
    action === 'settle'
      ? Boolean(paymentReference.trim())
      : Boolean(reason.trim()) &&
        (action !== 'offlineRefund' || Boolean(offlineRefundReference.trim()));

  return (
    <section
      className={styles.page}
      data-testid="module-payments-page"
      style={embedded ? { maxWidth: 'none' } : undefined}
    >
      {!embedded ? (
        <header>
          <h1>{t('moduleApps.admin.payments.title')}</h1>
          <p>{t('moduleApps.admin.payments.description')}</p>
        </header>
      ) : null}
      <div className={styles.actions}>
        <Button
          disabled={busyAction === 'export'}
          icon={<Download aria-hidden size={16} />}
          onClick={exportDiscrepancies}
        >
          {t('moduleApps.admin.payments.exportDiscrepancies')}
        </Button>
        {canWrite ? (
          <Button
            disabled={Boolean(busyAction)}
            icon={<RefreshCw aria-hidden size={16} />}
            onClick={() =>
              runDirectAction('reconcile', () =>
                adminCommercialService.moduleApps.reconcilePendingPayments({ limit: 100 }),
              )
            }
          >
            {t('moduleApps.admin.payments.reconcilePending')}
          </Button>
        ) : null}
      </div>
      {operationResult ? <p role="status">{operationResult}</p> : null}
      <div className={styles.controls}>
        <label>
          {t('moduleApps.admin.payments.filters.paymentStatus')}
          <Select
            value={paymentStatus ?? ''}
            options={['', 'created', 'pending', 'paid', 'failed', 'refunded'].map((value) => ({
              label: value
                ? statusLabels[value as keyof typeof statusLabels]
                : t('moduleApps.admin.payments.filters.all'),
              value,
            }))}
            onChange={(value) => updateFilter('paymentStatus', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.payments.filters.refundStatus')}
          <Select
            value={refundStatus ?? ''}
            options={['', 'requested', 'succeeded', 'failed'].map((value) => ({
              label: value
                ? statusLabels[value as keyof typeof statusLabels]
                : t('moduleApps.admin.payments.filters.all'),
              value,
            }))}
            onChange={(value) => updateFilter('refundStatus', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.payments.filters.discrepancyStatus')}
          <Select
            value={discrepancyStatus ?? ''}
            options={['', 'open', 'resolved'].map((value) => ({
              label: value
                ? statusLabels[value as keyof typeof statusLabels]
                : t('moduleApps.admin.payments.filters.all'),
              value,
            }))}
            onChange={(value) => updateFilter('discrepancyStatus', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.payments.filters.appId')}
          <Input
            maxLength={36}
            value={appId ?? ''}
            onChange={(event) => updateFilter('appId', event.target.value)}
          />
        </label>
        <label>
          {t('moduleApps.admin.payments.filters.orderId')}
          <Input
            maxLength={36}
            value={orderId ?? ''}
            onChange={(event) => updateFilter('orderId', event.target.value)}
          />
        </label>
      </div>
      <ModulePageState
        emptyKind={isFiltered ? 'filtered' : 'initial'}
        error={error}
        isEmpty={!isLoading && !error && (data?.items.length ?? 0) === 0}
        loading={isLoading}
        loadingLabel={t('moduleApps.admin.payments.loading')}
        retryLabel={t('moduleApps.admin.payments.retry')}
        emptyDescription={t(
          isFiltered
            ? 'moduleApps.admin.payments.filteredEmptyDescription'
            : 'moduleApps.admin.payments.emptyDescription',
        )}
        emptyTitle={t(
          isFiltered
            ? 'moduleApps.admin.payments.filteredEmptyTitle'
            : 'moduleApps.admin.payments.emptyTitle',
        )}
        onClearFilters={clearFilters}
        onRetry={() => mutate(listKey)}
      >
        <div>
          <PaymentReconciliationTable
            canWrite={canWrite}
            items={data?.items ?? []}
            statusLabels={statusLabels}
            labels={{
              acknowledge: t('moduleApps.admin.payments.actions.acknowledge'),
              action: t('moduleApps.admin.payments.columns.actions'),
              amount: t('moduleApps.admin.payments.columns.amount'),
              app: t('moduleApps.admin.payments.columns.app'),
              audit: t('moduleApps.admin.payments.columns.audit'),
              commerce: t('moduleApps.admin.payments.columns.commerce'),
              events: t('moduleApps.admin.payments.columns.events'),
              latestRun: t('moduleApps.admin.payments.columns.latestRun'),
              offlineRefund: t('moduleApps.admin.payments.actions.offlineRefund'),
              order: t('moduleApps.admin.payments.columns.order'),
              paymentMethod: t('moduleApps.admin.payments.columns.paymentMethod'),
              providerTrade: t('moduleApps.admin.payments.columns.providerTrade'),
              refund: t('moduleApps.admin.payments.actions.refund'),
              resolveRefund: t('moduleApps.admin.payments.actions.resolveRefund'),
              retryPayment: t('moduleApps.admin.payments.actions.retryPayment'),
              retryRefund: t('moduleApps.admin.payments.actions.retryRefund'),
              settle: t('moduleApps.admin.payments.actions.settle'),
              status: t('moduleApps.admin.payments.columns.status'),
            }}
            onOpenOfflineRefund={(row) => openAction('offlineRefund', row)}
            onOpenRefund={(row) => openAction('refund', row)}
            onOpenSettle={(row) => openAction('settle', row)}
            onAcknowledge={(discrepancyId) =>
              runDirectAction(`acknowledge:${discrepancyId}`, () =>
                adminCommercialService.moduleApps.acknowledgePaymentDiscrepancy({
                  discrepancyId,
                }),
              )
            }
            onResolveRefund={(targetOrderId) => {
              const target = data?.items.find((item) => item.orderId === targetOrderId);
              if (target) setResolutionTarget(target);
            }}
            onRetryPayment={(outTradeNo, provider) =>
              runDirectAction(`payment:${outTradeNo}`, () =>
                adminCommercialService.moduleApps.retryPaymentQuery({ outTradeNo, provider }),
              )
            }
            onRetryRefund={(targetOrderId) =>
              runDirectAction(`refund:${targetOrderId}`, () =>
                adminCommercialService.moduleApps.retryRefundStatus({ orderId: targetOrderId }),
              )
            }
          />
          <CursorPager
            hasNext={Boolean(data?.nextCursor)}
            hasPrevious={Boolean(searchParams.getAll('previousCursor').length)}
            nextLabel={t('moduleApps.admin.payments.next')}
            previousLabel={t('moduleApps.admin.payments.previous')}
            onPrevious={() => setSearchParams(retreatCursor(searchParams))}
            onNext={() =>
              data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
            }
          />
        </div>
      </ModulePageState>
      {canWrite ? (
        <Modal
          cancelText={t('cancel')}
          confirmLoading={submitting}
          okButtonProps={{ disabled: submitting || !actionIsValid }}
          okText={action ? t(`moduleApps.admin.payments.confirm.${action}`) : ''}
          open={Boolean(action)}
          title={action ? t(`moduleApps.admin.payments.modal.${action}`) : ''}
          onCancel={closeAction}
          onOk={submitAction}
        >
          <div className={styles.form}>
            {action === 'settle' ? (
              <label>
                {t('moduleApps.admin.payments.form.paymentReference')}
                <Input
                  required
                  maxLength={240}
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </label>
            ) : (
              <label>
                {t('moduleApps.admin.payments.form.reason')}
                <TextArea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            )}
            {action === 'offlineRefund' ? (
              <label>
                {t('moduleApps.admin.payments.form.offlineRefundReference')}
                <Input
                  required
                  maxLength={240}
                  value={offlineRefundReference}
                  onChange={(event) => setOfflineRefundReference(event.target.value)}
                />
              </label>
            ) : null}
            {actionError ? <p role="alert">{actionError}</p> : null}
          </div>
        </Modal>
      ) : null}
      <PendingRefundResolutionModal
        busy={busyAction?.startsWith('resolve:') ?? false}
        note={resolutionNote}
        open={Boolean(resolutionTarget)}
        resolution={resolution}
        title={t('moduleApps.admin.payments.manualResolution.title')}
        labels={{
          cancel: t('cancel'),
          chooseOutcome: t('moduleApps.admin.payments.manualResolution.chooseOutcome'),
          confirm: t('moduleApps.admin.payments.manualResolution.confirm'),
          description: t('moduleApps.admin.payments.manualResolution.description'),
          note: t('moduleApps.admin.payments.manualResolution.note'),
          notRefunded: t('moduleApps.admin.payments.manualResolution.notRefunded'),
          outcome: t('moduleApps.admin.payments.manualResolution.outcome'),
          refunded: t('moduleApps.admin.payments.manualResolution.refunded'),
        }}
        summary={
          resolutionTarget
            ? `${resolutionTarget.appName} · ${resolutionTarget.currency} ${resolutionTarget.totalAmount}`
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

ModulePaymentsPage.displayName = 'ModulePaymentsPage';

export default ModulePaymentsPage;
