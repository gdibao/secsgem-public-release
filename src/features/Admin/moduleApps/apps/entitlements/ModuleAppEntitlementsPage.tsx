'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';

import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useUnsavedChangesGuard } from '../../../shared/useUnsavedChangesGuard';
import BillingEditor from '../../BillingEditor';
import EntitlementEditor from '../../EntitlementEditor';
import { type ModuleAppAdminFormValues, normalizeModuleAppFormValues } from '../../formSchema';
import type { ModuleAppDetailOutletContext } from '../../layouts/ModuleAppDetailLayout';
import {
  clearModuleDraft,
  createModuleDraftScope,
  loadModuleDraft,
  saveModuleDraft,
} from '../../shared/draftStorage';

type EntitlementsDraft = Pick<ModuleAppAdminFormValues, 'billing' | 'entitlements'>;

const ModuleAppEntitlementsPage = memo(() => {
  const { t } = useTranslation('common');
  const { app, refresh } = useOutletContext<ModuleAppDetailOutletContext>();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const [form] = Form.useForm<EntitlementsDraft>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>();
  const draftScope = createModuleDraftScope(app.id, 'entitlements');

  useUnsavedChangesGuard({
    cancelText: t('moduleApps.admin.center.unsavedCancel'),
    confirmText: t('moduleApps.admin.center.unsavedDiscard'),
    isDirty: dirty,
    message: t('moduleApps.admin.center.unsavedConfirmation'),
    title: t('moduleApps.admin.center.unsavedTitle'),
  });

  useEffect(() => {
    const draft = loadModuleDraft<EntitlementsDraft>(draftScope);
    const values = normalizeModuleAppFormValues({
      billing: draft?.billing ?? app.billing,
      entitlements: draft?.entitlements ?? app.entitlements,
    });
    form.setFieldsValue({ billing: values.billing, entitlements: values.entitlements });
    setDirty(Boolean(draft));
    setSaveStatus(draft ? t('moduleApps.admin.entitlements.draftRestored') : undefined);
  }, [app.billing, app.entitlements, draftScope, form, t]);

  const persistDraft = () => {
    if (!canWrite) return;

    const values = form.getFieldsValue(true);
    try {
      saveModuleDraft(draftScope, values);
    } catch {
      setSaveStatus(t('moduleApps.admin.entitlements.draftRejected'));
      return;
    }
  };

  const save = async () => {
    if (!canWrite) return;

    const values = await form.validateFields();
    try {
      saveModuleDraft(draftScope, values);
    } catch {
      setSaveStatus(t('moduleApps.admin.entitlements.draftRejected'));
      return;
    }
    const normalized = normalizeModuleAppFormValues(values);
    const accepted: string[] = [];
    const failed: string[] = [];
    setSaving(true);
    setSaveStatus(undefined);

    try {
      await adminCommercialService.moduleApps.upsertEntitlements({
        appId: app.id,
        entitlements: normalized.entitlements,
      });
      accepted.push(t('moduleApps.admin.entitlements.entitlements'));
    } catch {
      failed.push(t('moduleApps.admin.entitlements.entitlements'));
    }

    try {
      await adminCommercialService.moduleApps.upsertBilling({
        appId: app.id,
        billing: normalized.billing,
      });
      accepted.push(t('moduleApps.admin.entitlements.billing'));
    } catch {
      failed.push(t('moduleApps.admin.entitlements.billing'));
    } finally {
      setSaving(false);
    }

    if (failed.length) {
      setSaveStatus(
        t('moduleApps.admin.entitlements.partialSave', {
          accepted: accepted.join(', ') || t('moduleApps.admin.entitlements.none'),
          failed: failed.join(', '),
        }),
      );
      return;
    }

    clearModuleDraft(draftScope);
    setDirty(false);
    setSaveStatus(t('moduleApps.admin.entitlements.saved'));
    await refresh();
  };

  return (
    <section data-testid="module-app-entitlements">
      <header>
        <h2>{t('moduleApps.admin.entitlements.title')}</h2>
        <p>{t('moduleApps.admin.entitlements.description')}</p>
      </header>
      <Form<EntitlementsDraft>
        disabled={!canWrite}
        form={form}
        layout="vertical"
        onFinish={save}
        onValuesChange={() => {
          if (!canWrite) return;

          setDirty(true);
          persistDraft();
        }}
      >
        <EntitlementEditor disabled={!canWrite} />
        <BillingEditor />
        {saveStatus ? <p role="status">{saveStatus}</p> : null}
        {canWrite ? (
          <Button htmlType="submit" loading={saving} type="primary">
            {t('moduleApps.admin.entitlements.save')}
          </Button>
        ) : null}
      </Form>
    </section>
  );
});

ModuleAppEntitlementsPage.displayName = 'ModuleAppEntitlementsPage';

export default ModuleAppEntitlementsPage;
