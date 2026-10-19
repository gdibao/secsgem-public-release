'use client';

import { Input, Modal, Select, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminCommercialService } from '@/services/adminCommercial';

import type { ModuleAppPayoutRow } from '../../PayoutTable';

const styles = createStaticStyles(({ css }) => ({
  form: css`
    display: grid;
    gap: 12px;
  `,
}));

type PayoutModalMode = 'create' | 'manage';
type ManageOperation = 'manual' | 'transition';
type TransitionStatus = 'eligible' | 'failed' | 'pending' | 'processing' | 'reversed';
type PayoutActionService = {
  createPayoutBatch: (input: {
    publisherId: string;
    requestedAmount: number;
    revenueEntryIds: string[];
  }) => Promise<unknown>;
  recordManualAlipayPayout: (input: {
    batchId: string;
    evidenceReference: string;
    recipientMask: string;
    transactionNo: string;
  }) => Promise<unknown>;
  transitionPayoutBatch: (input: {
    batchId: string;
    failureReason?: string;
    status: TransitionStatus;
  }) => Promise<unknown>;
};

type PayoutActionModalProps = {
  mode: PayoutModalMode;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  open: boolean;
  payout?: ModuleAppPayoutRow;
  service?: PayoutActionService;
};

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const splitIds = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const PayoutActionModal = memo<PayoutActionModalProps>(
  ({ mode, onClose, onSuccess, open, payout, service = adminCommercialService.moduleApps }) => {
    const { t } = useTranslation('common');
    const [error, setError] = useState<string>();
    const [evidenceReference, setEvidenceReference] = useState('');
    const [failureReason, setFailureReason] = useState('');
    const [operation, setOperation] = useState<ManageOperation>('transition');
    const [publisherId, setPublisherId] = useState('');
    const [recipientMask, setRecipientMask] = useState('');
    const [requestedAmount, setRequestedAmount] = useState('');
    const [revenueEntryIds, setRevenueEntryIds] = useState('');
    const [status, setStatus] = useState<TransitionStatus>('processing');
    const [submitting, setSubmitting] = useState(false);
    const [transactionNo, setTransactionNo] = useState('');

    useEffect(() => {
      if (!open) return;
      setError(undefined);
      setEvidenceReference('');
      setFailureReason('');
      setOperation('transition');
      setPublisherId('');
      setRecipientMask(payout?.recipientMask ?? '');
      setRequestedAmount('');
      setRevenueEntryIds('');
      setStatus('processing');
      setTransactionNo('');
    }, [mode, open, payout?.id, payout?.recipientMask]);

    const revenueIds = splitIds(revenueEntryIds);
    const amount = Number(requestedAmount);
    const createValid =
      UUID_PATTERN.test(publisherId.trim()) &&
      Number.isFinite(amount) &&
      amount > 0 &&
      revenueIds.length > 0 &&
      revenueIds.every((id) => UUID_PATTERN.test(id));
    const manualValid =
      Boolean(payout?.id) &&
      Boolean(transactionNo.trim()) &&
      recipientMask.trim().length >= 3 &&
      recipientMask.includes('*') &&
      Boolean(evidenceReference.trim());
    const transitionValid =
      Boolean(payout?.id) && (status !== 'failed' || Boolean(failureReason.trim()));
    const formValid =
      mode === 'create' ? createValid : operation === 'manual' ? manualValid : transitionValid;

    const submit = async () => {
      if (!formValid) return;
      setSubmitting(true);
      setError(undefined);
      try {
        if (mode === 'create') {
          await service.createPayoutBatch({
            publisherId: publisherId.trim(),
            requestedAmount: amount,
            revenueEntryIds: revenueIds,
          });
        } else if (operation === 'manual' && payout) {
          await service.recordManualAlipayPayout({
            batchId: payout.id,
            evidenceReference: evidenceReference.trim(),
            recipientMask: recipientMask.trim(),
            transactionNo: transactionNo.trim(),
          });
        } else if (payout) {
          await service.transitionPayoutBatch({
            batchId: payout.id,
            failureReason: failureReason.trim() || undefined,
            status,
          });
        }
        await onSuccess();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t('moduleApps.admin.payouts.actionError'),
        );
      } finally {
        setSubmitting(false);
      }
    };
    const confirmationKey = mode === 'create' ? 'create' : operation;
    const statusLabels = {
      eligible: t('moduleApps.admin.finance.status.eligible'),
      failed: t('moduleApps.admin.finance.status.failed'),
      pending: t('moduleApps.admin.finance.status.pending'),
      processing: t('moduleApps.admin.finance.status.processing'),
      reversed: t('moduleApps.admin.finance.status.reversed'),
    };

    return (
      <Modal
        cancelText={t('cancel')}
        confirmLoading={submitting}
        okButtonProps={{ disabled: submitting || !formValid }}
        okText={t(`moduleApps.admin.payouts.confirm.${confirmationKey}`)}
        open={open}
        title={t(`moduleApps.admin.payouts.modal.${mode}`)}
        onCancel={() => !submitting && onClose()}
        onOk={submit}
      >
        <div className={styles.form}>
          {mode === 'create' ? (
            <>
              <label>
                {t('moduleApps.admin.payouts.form.publisherId')}
                <Input
                  required
                  maxLength={36}
                  value={publisherId}
                  onChange={(event) => setPublisherId(event.target.value)}
                />
              </label>
              <label>
                {t('moduleApps.admin.payouts.form.requestedAmount')}
                <Input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={requestedAmount}
                  onChange={(event) => setRequestedAmount(event.target.value)}
                />
              </label>
              <label>
                {t('moduleApps.admin.payouts.form.revenueEntryIds')}
                <TextArea
                  required
                  value={revenueEntryIds}
                  onChange={(event) => setRevenueEntryIds(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {t('moduleApps.admin.payouts.form.operation')}
                <Select
                  value={operation}
                  options={[
                    {
                      label: t('moduleApps.admin.payouts.operation.transition'),
                      value: 'transition',
                    },
                    { label: t('moduleApps.admin.payouts.operation.manual'), value: 'manual' },
                  ]}
                  onChange={(value) => {
                    setError(undefined);
                    setOperation(value as ManageOperation);
                  }}
                />
              </label>
              {operation === 'transition' ? (
                <>
                  <label>
                    {t('moduleApps.admin.payouts.form.status')}
                    <Select
                      value={status}
                      options={['pending', 'eligible', 'processing', 'failed', 'reversed'].map(
                        (value) => ({ label: statusLabels[value as TransitionStatus], value }),
                      )}
                      onChange={(value) => setStatus(value as TransitionStatus)}
                    />
                  </label>
                  {status === 'failed' ? (
                    <label>
                      {t('moduleApps.admin.payouts.form.failureReason')}
                      <TextArea
                        required
                        maxLength={1000}
                        value={failureReason}
                        onChange={(event) => setFailureReason(event.target.value)}
                      />
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <label>
                    {t('moduleApps.admin.payouts.form.transactionNo')}
                    <Input
                      required
                      maxLength={240}
                      value={transactionNo}
                      onChange={(event) => setTransactionNo(event.target.value)}
                    />
                  </label>
                  <label>
                    {t('moduleApps.admin.payouts.form.recipientMask')}
                    <Input
                      required
                      maxLength={200}
                      minLength={3}
                      value={recipientMask}
                      onChange={(event) => setRecipientMask(event.target.value)}
                    />
                  </label>
                  <label>
                    {t('moduleApps.admin.payouts.form.evidenceReference')}
                    <TextArea
                      required
                      maxLength={1000}
                      value={evidenceReference}
                      onChange={(event) => setEvidenceReference(event.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </Modal>
    );
  },
);

PayoutActionModal.displayName = 'PayoutActionModal';

export default PayoutActionModal;
