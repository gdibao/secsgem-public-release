'use client';

import { type AdminDependencyImpact } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { ButtonProps } from 'antd';
import { Button, Input, Modal, Popconfirm, Typography } from 'antd';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AdminDangerousActionConfirmationError,
  type AdminDangerousActionEnvelope,
  type AdminDangerousActionId,
  buildAdminDangerousActionConfirm,
  buildAdminDangerousActionEnvelope,
  validateAdminDangerousActionConfirmation,
} from './adminDangerousActions';
import AdminDependencyImpactPreview from './AdminDependencyImpactPreview';

type AdminDangerousActionButtonProps<TActionId extends AdminDangerousActionId> = Omit<
  ButtonProps,
  'children' | 'onClick'
> & {
  actionId: TActionId;
  children: ReactNode;
  confirmDescription?: ReactNode;
  confirmTitle?: ReactNode;
  loadPreflight?: () => Promise<AdminDependencyImpact>;
  onConfirm: (input: AdminDangerousActionEnvelope<TActionId>) => Promise<void> | void;
};

const AdminDangerousActionButton = <TActionId extends AdminDangerousActionId>({
  actionId,
  children,
  confirmDescription,
  confirmTitle,
  loadPreflight,
  onConfirm,
  ...buttonProps
}: AdminDangerousActionButtonProps<TActionId>) => {
  const { t } = useTranslation('subscription');
  const requirement = buildAdminDangerousActionConfirm(actionId);
  const [open, setOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<AdminDangerousActionConfirmationError[]>([]);
  const [preflight, setPreflight] = useState<AdminDependencyImpact>();
  const [preflightError, setPreflightError] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const closeTypedConfirm = () => {
    setOpen(false);
    setConfirmationText('');
    setReason('');
    setErrors([]);
    setPreflight(undefined);
    setPreflightError(false);
  };

  const openTypedConfirm = async () => {
    setOpen(true);
    if (!loadPreflight) return;

    setPreflightLoading(true);
    setPreflightError(false);
    try {
      setPreflight(await loadPreflight());
    } catch {
      setPreflightError(true);
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleTypedConfirm = async () => {
    if (submitting) return;

    const input = buildAdminDangerousActionEnvelope(actionId, {
      confirmed: true,
      confirmationText,
      reason,
    });
    const result = validateAdminDangerousActionConfirmation(actionId, input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(input);
      closeTypedConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  if (!requirement?.requiresTypedConfirmation) {
    return (
      <Popconfirm
        description={confirmDescription ?? requirement?.confirmation.description}
        okButtonProps={{ danger: buttonProps.danger }}
        okText={typeof children === 'string' ? children : requirement?.confirmation.title}
        title={confirmTitle ?? requirement?.confirmation.title ?? actionId}
        onConfirm={() =>
          onConfirm(buildAdminDangerousActionEnvelope(actionId, { confirmed: true }))
        }
      >
        <Button {...buttonProps}>{children}</Button>
      </Popconfirm>
    );
  }

  return (
    <>
      <Button {...buttonProps} onClick={openTypedConfirm}>
        {children}
      </Button>
      <Modal
        closable={!submitting}
        confirmLoading={submitting}
        keyboard={!submitting}
        maskClosable={!submitting}
        okText={typeof children === 'string' ? children : requirement.confirmation.title}
        open={open}
        title={confirmTitle ?? requirement.confirmation.title}
        okButtonProps={{
          danger: true,
          disabled: Boolean(loadPreflight) && (!preflight?.canProceed || preflightLoading),
        }}
        onOk={handleTypedConfirm}
        onCancel={() => {
          if (!submitting) closeTypedConfirm();
        }}
      >
        <Flexbox gap={12}>
          <Typography.Text>
            {confirmDescription ?? requirement.confirmation.description}
          </Typography.Text>
          <AdminDependencyImpactPreview
            error={preflightError}
            impact={preflight}
            loading={preflightLoading}
          />
          <Typography.Text type="secondary">
            {t('admin.dangerousAction.typedConfirm', 'Type {{confirmationText}} to confirm.', {
              confirmationText: requirement.requiredConfirmationText,
            })}
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
          {requirement.requiresReason ? (
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
      </Modal>
    </>
  );
};

AdminDangerousActionButton.displayName = 'AdminDangerousActionButton';

export default memo(AdminDangerousActionButton) as typeof AdminDangerousActionButton;
