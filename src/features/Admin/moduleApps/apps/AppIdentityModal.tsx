'use client';

import type { ModuleAppSource, ModuleAppStatus } from '@lobechat/types';
import { Input, Modal, Select, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminModuleAppDetail } from '../types';
import { createDefaultModuleAppIdentity, type ModuleAppIdentityFormValues } from './identityForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    margin: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusSM};

    line-height: 20px;
    color: ${cssVar.colorErrorText};

    background: ${cssVar.colorErrorBg};
  `,
  field: css`
    display: grid;
    gap: 6px;

    min-width: 0;

    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
  form: css`
    display: grid;
    gap: 14px;
  `,
}));

const isModuleAppStatus = (value: string): value is ModuleAppStatus =>
  value === 'draft' || value === 'published' || value === 'unpublished';

const isModuleAppSource = (value: string): value is ModuleAppSource =>
  value === 'admin' || value === 'developer' || value === 'system' || value === 'user';

export type AppIdentityModalProps = {
  currentApp?: AdminModuleAppDetail | null;
  draft?: ModuleAppIdentityFormValues | null;
  onCancel: () => void;
  onDraftChange?: (draft: ModuleAppIdentityFormValues) => void;
  onSubmit: (identity: ModuleAppIdentityFormValues) => Promise<void>;
  open: boolean;
  submitting?: boolean;
};

const AppIdentityModal = memo<AppIdentityModalProps>(
  ({ currentApp, draft, onCancel, onDraftChange, onSubmit, open, submitting }) => {
    const { t } = useTranslation('common');
    const [identity, setIdentity] = useState<ModuleAppIdentityFormValues>(() =>
      createDefaultModuleAppIdentity(),
    );
    const [submitError, setSubmitError] = useState<string>();

    useEffect(() => {
      if (!open) return;
      setIdentity({
        ...createDefaultModuleAppIdentity(),
        ...(currentApp ?? draft),
      });
      setSubmitError(undefined);
    }, [currentApp, draft, open]);

    const update = <Key extends keyof ModuleAppIdentityFormValues>(
      key: Key,
      value: ModuleAppIdentityFormValues[Key],
    ) => {
      setSubmitError(undefined);
      setIdentity((current) => {
        const next = { ...current, [key]: value };
        if (!currentApp) onDraftChange?.(next);
        return next;
      });
    };

    const valid = Boolean(
      identity.displayName?.trim() &&
      identity.slug?.trim() &&
      identity.category?.trim() &&
      identity.description?.trim(),
    );

    const handleSubmit = async () => {
      setSubmitError(undefined);
      try {
        await onSubmit(identity);
      } catch (error) {
        setSubmitError(
          error instanceof Error && error.message.trim()
            ? error.message
            : t('moduleApps.admin.apps.identity.submitError'),
        );
      }
    };

    return (
      <Modal
        destroyOnHidden
        cancelText={t('cancel')}
        confirmLoading={submitting}
        okButtonProps={{ disabled: submitting || !valid }}
        okText={t('ok')}
        open={open}
        title={t(
          currentApp
            ? 'moduleApps.admin.apps.identity.editTitle'
            : 'moduleApps.admin.apps.identity.createTitle',
        )}
        onCancel={onCancel}
        onOk={handleSubmit}
      >
        <div className={styles.form} data-testid="module-app-identity-form">
          <label className={styles.field} htmlFor="module-app-identity-display-name">
            <span>{t('moduleApps.admin.apps.identity.displayName')}</span>
            <Input
              autoFocus
              required
              id="module-app-identity-display-name"
              value={identity.displayName ?? ''}
              onChange={(event) => update('displayName', event.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-slug">
            <span>{t('moduleApps.admin.apps.identity.slug')}</span>
            <Input
              required
              id="module-app-identity-slug"
              value={identity.slug ?? ''}
              onChange={(event) => update('slug', event.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-category">
            <span>{t('moduleApps.admin.apps.identity.category')}</span>
            <Input
              required
              id="module-app-identity-category"
              value={identity.category ?? ''}
              onChange={(event) => update('category', event.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-status">
            <span>{t('moduleApps.admin.apps.identity.status')}</span>
            <Select
              id="module-app-identity-status"
              value={identity.status ?? 'draft'}
              options={[
                { label: t('moduleApps.admin.apps.status.draft'), value: 'draft' },
                { label: t('moduleApps.admin.apps.status.published'), value: 'published' },
                { label: t('moduleApps.admin.apps.status.unpublished'), value: 'unpublished' },
              ]}
              onChange={(value) => {
                const nextStatus = String(value ?? '');
                if (isModuleAppStatus(nextStatus)) update('status', nextStatus);
              }}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-source">
            <span>{t('moduleApps.admin.apps.identity.source')}</span>
            <Select
              id="module-app-identity-source"
              value={identity.source ?? 'admin'}
              options={[
                { label: t('moduleApps.admin.apps.source.admin'), value: 'admin' },
                { label: t('moduleApps.admin.apps.source.developer'), value: 'developer' },
                { label: t('moduleApps.admin.apps.source.system'), value: 'system' },
                { label: t('moduleApps.admin.apps.source.user'), value: 'user' },
              ]}
              onChange={(value) => {
                const nextSource = String(value ?? '');
                if (isModuleAppSource(nextSource)) update('source', nextSource);
              }}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-description">
            <span>{t('moduleApps.admin.apps.identity.description')}</span>
            <TextArea
              required
              id="module-app-identity-description"
              rows={3}
              value={identity.description ?? ''}
              onChange={(event) => update('description', event.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor="module-app-identity-tags">
            <span>{t('moduleApps.admin.apps.identity.tags')}</span>
            <Input
              id="module-app-identity-tags"
              value={
                Array.isArray(identity.tags) ? identity.tags.join(', ') : (identity.tags ?? '')
              }
              onChange={(event) =>
                update(
                  'tags',
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          {submitError ? (
            <p className={styles.error} role="alert">
              {submitError}
            </p>
          ) : null}
        </div>
      </Modal>
    );
  },
);

AppIdentityModal.displayName = 'AppIdentityModal';

export default AppIdentityModal;
