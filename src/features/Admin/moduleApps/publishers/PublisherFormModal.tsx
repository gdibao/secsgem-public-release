'use client';

import { Input, Modal } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type PublisherFormValues = {
  displayName: string;
  recipientMask?: string;
  userId: string;
};

export type PublisherFormModalProps = {
  onCancel: () => void;
  onSubmit: (values: PublisherFormValues) => Promise<void>;
  open: boolean;
  submitting?: boolean;
};

const PublisherFormModal = memo<PublisherFormModalProps>(
  ({ onCancel, onSubmit, open, submitting }) => {
    const { t } = useTranslation('common');
    const [values, setValues] = useState<PublisherFormValues>({
      displayName: '',
      recipientMask: '',
      userId: '',
    });
    const [error, setError] = useState<string>();

    useEffect(() => {
      if (open) {
        setError(undefined);
        setValues({ displayName: '', recipientMask: '', userId: '' });
      }
    }, [open]);

    const submit = async () => {
      setError(undefined);
      try {
        await onSubmit({
          ...values,
          displayName: values.displayName.trim(),
          recipientMask: values.recipientMask?.trim() || undefined,
          userId: values.userId.trim(),
        });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t('moduleApps.admin.publishers.createError'),
        );
      }
    };
    const recipientMask = values.recipientMask?.trim() ?? '';
    const displayName = values.displayName.trim();
    const userId = values.userId.trim();
    const recipientIsValid =
      !recipientMask ||
      (recipientMask.length >= 3 && recipientMask.length <= 200 && recipientMask.includes('*'));
    const valid = Boolean(
      displayName.length >= 1 &&
      displayName.length <= 200 &&
      userId.length >= 1 &&
      userId.length <= 255 &&
      recipientIsValid,
    );

    return (
      <Modal
        destroyOnHidden
        cancelText={t('cancel')}
        confirmLoading={submitting}
        okButtonProps={{ disabled: submitting || !valid }}
        okText={t('moduleApps.admin.publishers.create')}
        open={open}
        title={t('moduleApps.admin.publishers.create')}
        onCancel={onCancel}
        onOk={submit}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            {t('moduleApps.admin.publishers.displayName')}
            <Input
              autoFocus
              required
              maxLength={200}
              value={values.displayName}
              onChange={(event) =>
                setValues((current) => ({ ...current, displayName: event.target.value }))
              }
            />
          </label>
          <label>
            {t('moduleApps.admin.publishers.ownerUserId')}
            <Input
              required
              maxLength={255}
              value={values.userId}
              onChange={(event) =>
                setValues((current) => ({ ...current, userId: event.target.value }))
              }
            />
          </label>
          <label>
            {t('moduleApps.admin.publishers.recipientMask')}
            <Input
              maxLength={200}
              value={values.recipientMask}
              onChange={(event) =>
                setValues((current) => ({ ...current, recipientMask: event.target.value }))
              }
            />
          </label>
          {values.recipientMask && !recipientIsValid ? (
            <p role="alert">{t('moduleApps.admin.publishers.recipientMaskError')}</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </Modal>
    );
  },
);

PublisherFormModal.displayName = 'PublisherFormModal';

export default PublisherFormModal;
