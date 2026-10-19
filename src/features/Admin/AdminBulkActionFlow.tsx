'use client';

import { Flexbox } from '@lobehub/ui';
import type { ButtonProps } from 'antd';
import { Alert, Button, Input, Modal, Typography } from 'antd';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import {
  type AdminDangerousActionConfirmationError,
  type AdminDangerousActionEnvelope,
  type AdminDangerousActionId,
  buildAdminDangerousActionConfirm,
  buildAdminDangerousActionEnvelope,
  validateAdminDangerousActionConfirmation,
} from './adminDangerousActions';

type AdminBulkActionFlowStep = 'confirm' | 'progress' | 'done' | 'error';

type AdminBulkActionResultSummary = {
  detail?: ReactNode;
  failed?: number;
  requested?: number;
  skipped?: number;
  succeeded?: number;
  title?: ReactNode;
};

type AdminBulkActionFlowProps<TActionId extends AdminDangerousActionId> = Omit<
  ButtonProps,
  'children' | 'onClick'
> & {
  actionId: TActionId;
  children: ReactNode;
  confirmDescription?: ReactNode;
  confirmTitle: ReactNode;
  count: number;
  onRun: (input: AdminDangerousActionEnvelope<TActionId>) => Promise<unknown>;
  onSuccess?: () => Promise<void> | void;
  progressDescription?: ReactNode;
  progressTitle?: ReactNode;
  summary: (result: unknown) => AdminBulkActionResultSummary;
};

const AdminBulkActionFlow = <TActionId extends AdminDangerousActionId>({
  actionId,
  children,
  confirmDescription,
  confirmTitle,
  count,
  onRun,
  onSuccess,
  progressDescription,
  progressTitle,
  summary,
  ...buttonProps
}: AdminBulkActionFlowProps<TActionId>) => {
  const { t } = useTranslation('subscription');
  const requirement = buildAdminDangerousActionConfirm(actionId);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AdminBulkActionFlowStep>('confirm');
  const [confirmationText, setConfirmationText] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<AdminDangerousActionConfirmationError[]>([]);
  const [resultSummary, setResultSummary] = useState<AdminBulkActionResultSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => {
    setStep('confirm');
    setConfirmationText('');
    setReason('');
    setErrors([]);
    setResultSummary(null);
    setErrorMessage(null);
  };

  const close = () => {
    if (step === 'progress') return;
    setOpen(false);
    reset();
  };

  const run = async () => {
    const input = buildAdminDangerousActionEnvelope(actionId, {
      confirmed: true,
      confirmationText,
      reason,
    });
    const validation = validateAdminDangerousActionConfirmation(actionId, input);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    setStep('progress');
    setErrors([]);
    setErrorMessage(null);
    try {
      const result = await onRun(input);
      setResultSummary(summary(result));
      setStep('done');
      await onSuccess?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('admin.bulkAction.errorFallback', '操作失败'),
      );
      setStep('error');
    }
  };

  const footer =
    step === 'confirm'
      ? [
          <Button key="cancel" onClick={close}>
            {t('admin.bulkAction.cancel', '取消')}
          </Button>,
          <Button danger={buttonProps.danger} key="run" type="primary" onClick={run}>
            {typeof children === 'string' ? children : t('admin.bulkAction.confirm', '确认执行')}
          </Button>,
        ]
      : step === 'progress'
        ? null
        : [
            <Button key="close" type={step === 'done' ? 'primary' : 'default'} onClick={close}>
              {t('admin.bulkAction.close', '关闭')}
            </Button>,
          ];

  const renderSummaryCounts = () => {
    if (!resultSummary) return null;

    const items = [
      resultSummary.requested == null
        ? null
        : `${t('admin.bulkAction.requested', '请求')} ${resultSummary.requested}`,
      resultSummary.succeeded == null
        ? null
        : `${t('admin.bulkAction.succeeded', '成功')} ${resultSummary.succeeded}`,
      resultSummary.failed == null
        ? null
        : `${t('admin.bulkAction.failed', '失败')} ${resultSummary.failed}`,
      resultSummary.skipped == null
        ? null
        : `${t('admin.bulkAction.skipped', '跳过')} ${resultSummary.skipped}`,
    ].filter(Boolean);

    if (items.length === 0) return null;

    return <Typography.Text type="secondary">{items.join(' · ')}</Typography.Text>;
  };

  return (
    <>
      <Button
        {...buttonProps}
        disabled={buttonProps.disabled || count <= 0}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Modal
        closable={step !== 'progress'}
        footer={footer}
        maskClosable={step !== 'progress'}
        open={open}
        title={step === 'confirm' ? confirmTitle : (progressTitle ?? confirmTitle)}
        onCancel={close}
      >
        {step === 'confirm' ? (
          <Flexbox gap={12}>
            <Typography.Text>
              {confirmDescription ?? requirement?.confirmation.description}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('admin.bulkAction.count', '将处理 {{count}} 个项目。', { count })}
            </Typography.Text>
            {requirement?.requiresTypedConfirmation ? (
              <>
                <Typography.Text type="secondary">
                  {t(
                    'admin.dangerousAction.typedConfirm',
                    'Type {{confirmationText}} to confirm.',
                    {
                      confirmationText: requirement.requiredConfirmationText,
                    },
                  )}
                </Typography.Text>
                <Input
                  autoFocus
                  placeholder={requirement.requiredConfirmationText}
                  value={confirmationText}
                  onChange={(event) => {
                    setConfirmationText(event.target.value);
                    setErrors([]);
                  }}
                />
              </>
            ) : null}
            {requirement?.allowsReason ? (
              <Input.TextArea
                placeholder={t('admin.dangerousAction.reasonPlaceholder', 'Reason')}
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setErrors([]);
                }}
              />
            ) : null}
            {errors.map((error) => (
              <Typography.Text key={error} type="danger">
                {t(`admin.dangerousAction.errors.${error}`, error)}
              </Typography.Text>
            ))}
          </Flexbox>
        ) : step === 'progress' ? (
          <Flexbox align="center" gap={16}>
            <NeuralNetworkLoading size={48} />
            <Typography.Text>
              {progressDescription ??
                t('admin.bulkAction.progress', '正在执行批量操作，请勿关闭页面。')}
            </Typography.Text>
          </Flexbox>
        ) : step === 'done' ? (
          <Flexbox gap={12}>
            <Alert
              message={resultSummary?.title ?? t('admin.bulkAction.done', '批量操作已完成')}
              type="success"
            />
            {renderSummaryCounts()}
            {resultSummary?.detail}
          </Flexbox>
        ) : (
          <Flexbox gap={12}>
            <Alert
              description={errorMessage}
              message={t('admin.bulkAction.error', '批量操作失败')}
              type="error"
            />
          </Flexbox>
        )}
      </Modal>
    </>
  );
};

AdminBulkActionFlow.displayName = 'AdminBulkActionFlow';

export default memo(AdminBulkActionFlow) as typeof AdminBulkActionFlow;
