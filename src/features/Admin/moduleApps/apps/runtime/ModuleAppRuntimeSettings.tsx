'use client';

import { Button, Switch, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RotateCcw, Save } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { mutate } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import type { ModuleAppRuntimeSettingsData } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  description: css`
    margin: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  field: css`
    display: grid;
    gap: 6px;
    min-width: 0;
  `,
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
  `,
  input: css`
    width: 100%;
    min-width: 0;
    height: 36px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &:focus-visible {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }

    &:disabled {
      cursor: not-allowed;
      color: ${cssVar.colorTextDisabled};
      background: ${cssVar.colorBgContainerDisabled};
    }
  `,
  label: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  notice: css`
    margin: 0;
    padding-block: 10px;
    padding-inline: 12px;
    border-inline-start: 3px solid ${cssVar.colorWarning};

    color: ${cssVar.colorText};

    background: ${cssVar.colorWarningBg};
  `,
  panel: css`
    display: grid;
    gap: 18px;
  `,
  secretHint: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  switchGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0 20px;
  `,
  switchRow: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;

    min-height: 64px;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  switchText: css`
    display: grid;
    gap: 3px;

    strong {
      font-size: 14px;
      font-weight: 600;
    }

    span {
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

type RuntimeSettingsForm = {
  executionEnabled: boolean;
  internalToken: string;
  internalUrl: string;
  invocationEnabled: boolean;
  publicExecutionEnabled: boolean;
  publicOrigin: string;
  scheduleDispatchEnabled: boolean;
  workflowPrivilegedExecutorsEnabled: boolean;
};

const buildFormValues = (settings: ModuleAppRuntimeSettingsData): RuntimeSettingsForm => ({
  executionEnabled: settings.requestedSwitches.executionEnabled,
  internalToken: '',
  internalUrl: settings.internalUrl,
  invocationEnabled: settings.requestedSwitches.invocationEnabled,
  publicExecutionEnabled: settings.requestedSwitches.publicExecutionEnabled,
  publicOrigin: settings.publicOrigin,
  scheduleDispatchEnabled: settings.requestedSwitches.scheduleDispatchEnabled,
  workflowPrivilegedExecutorsEnabled: settings.requestedSwitches.workflowPrivilegedExecutorsEnabled,
});

const SwitchRow = ({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) => (
  <label className={styles.switchRow}>
    <span className={styles.switchText}>
      <strong>{label}</strong>
      <span>{description}</span>
    </span>
    <Switch aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
  </label>
);

const ModuleAppRuntimeSettings = memo<{
  canWrite?: boolean;
  settings: ModuleAppRuntimeSettingsData;
}>(({ canWrite = true, settings }) => {
  const { t: translate } = useTranslation('common');
  const t = (key: string, options?: Record<string, unknown>) =>
    translate(key as any, options as any);
  const resolvedInitialValues = useMemo(() => buildFormValues(settings), [settings]);
  const [initialValues, setInitialValues] = useState(resolvedInitialValues);
  const [values, setValues] = useState(resolvedInitialValues);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setInitialValues(resolvedInitialValues);
    setValues(resolvedInitialValues);
  }, [resolvedInitialValues]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const tokenAvailable = settings.internalTokenConfigured || Boolean(values.internalToken.trim());
  const internalConnectionReady = Boolean(values.internalUrl.trim()) && tokenAvailable;
  const publicConnectionReady = internalConnectionReady && Boolean(values.publicOrigin.trim());
  const requestedBlocked = Object.entries(settings.requestedSwitches).some(
    ([key, enabled]) =>
      enabled && !settings.switches[key as keyof ModuleAppRuntimeSettingsData['switches']],
  );

  const setValue = <Key extends keyof RuntimeSettingsForm>(
    key: Key,
    value: RuntimeSettingsForm[Key],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const setExecutionEnabled = (enabled: boolean) =>
    setValues((current) => ({
      ...current,
      executionEnabled: enabled,
      ...(!enabled
        ? {
            invocationEnabled: false,
            publicExecutionEnabled: false,
            scheduleDispatchEnabled: false,
            workflowPrivilegedExecutorsEnabled: false,
          }
        : {}),
    }));

  const save = async () => {
    if (!canWrite) return;
    setSubmitting(true);
    try {
      const updates = [
        { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: values.executionEnabled },
        {
          key: APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
          value: values.publicExecutionEnabled,
        },
        {
          key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
          value: values.invocationEnabled,
        },
        {
          key: APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
          value: values.scheduleDispatchEnabled,
        },
        {
          key: APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
          value: values.workflowPrivilegedExecutorsEnabled,
        },
        { key: APP_SETTING_KEYS.moduleAppRuntimeInternalUrl, value: values.internalUrl },
        { key: APP_SETTING_KEYS.moduleAppRuntimePublicOrigin, value: values.publicOrigin },
        ...(values.internalToken.trim()
          ? [
              {
                key: APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
                value: values.internalToken,
              },
            ]
          : []),
      ];
      await adminCommercialService.setAppSettingsBatch({ updates });
      await Promise.all([
        mutate(ADMIN_SETTINGS_SECTION_SWR_KEY('module-runtime')),
        mutate(moduleAppCacheKeys.runtimeDiagnostics()),
      ]);
      const nextValues = { ...values, internalToken: '' };
      setInitialValues(nextValues);
      setValues(nextValues);
      toast.success(t('moduleApps.admin.runtime.settings.saved'));
    } catch (error) {
      const messageKey =
        error instanceof Error &&
        [
          'MODULE_APP_PUBLIC_EXECUTION_REQUIRES_EXECUTION',
          'MODULE_APP_PUBLIC_EXECUTION_CONFIG_REQUIRED',
          'MODULE_APP_RUNTIME_INVOCATION_REQUIRES_EXECUTION',
          'MODULE_APP_RUNTIME_INVOCATION_CONFIG_REQUIRED',
          'MODULE_APP_RUNTIME_CONFIG_SOURCE_MISMATCH',
          'MODULE_APP_RUNTIME_AUTH_FAILED',
          'MODULE_APP_RUNTIME_NOT_READY',
          'MODULE_APP_SCHEDULE_DISPATCH_REQUIRES_EXECUTION',
          'MODULE_APP_WORKFLOW_EXECUTORS_REQUIRE_EXECUTION',
        ].includes(error.message)
          ? `moduleApps.admin.runtime.settings.errors.${error.message}`
          : 'moduleApps.admin.runtime.settings.saveFailed';
      toast.error(t(messageKey));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.panel} data-testid="module-runtime-settings">
      {settings.source.legacyEnvironmentKeys.length > 0 ? (
        <p className={styles.notice} role="status">
          {t('moduleApps.admin.runtime.settings.environmentFallback', {
            count: settings.source.legacyEnvironmentKeys.length,
          })}
        </p>
      ) : null}
      {requestedBlocked ? (
        <p className={styles.notice} role="status">
          {t('moduleApps.admin.runtime.settings.safetyBlocked')}
        </p>
      ) : null}
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span className={styles.label}>{t('moduleApps.admin.runtime.settings.internalUrl')}</span>
          <input
            className={styles.input}
            disabled={submitting || !canWrite}
            type="url"
            value={values.internalUrl}
            onChange={(event) => setValue('internalUrl', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            {t('moduleApps.admin.runtime.settings.publicOrigin')}
          </span>
          <input
            className={styles.input}
            disabled={submitting || !canWrite}
            type="url"
            value={values.publicOrigin}
            onChange={(event) => setValue('publicOrigin', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            {t('moduleApps.admin.runtime.settings.internalToken')}
          </span>
          <input
            autoComplete="new-password"
            className={styles.input}
            disabled={submitting || !canWrite}
            placeholder={settings.internalTokenMasked ?? undefined}
            type="password"
            value={values.internalToken}
            onChange={(event) => setValue('internalToken', event.target.value)}
          />
          <span className={styles.secretHint}>
            {t(
              settings.internalTokenConfigured
                ? 'moduleApps.admin.runtime.settings.internalTokenConfigured'
                : 'moduleApps.admin.runtime.settings.internalTokenMissing',
            )}
          </span>
        </label>
      </div>
      <div className={styles.switchGrid}>
        <SwitchRow
          checked={values.executionEnabled}
          description={t('moduleApps.admin.runtime.settings.executionDescription')}
          disabled={submitting || !canWrite}
          label={t('moduleApps.admin.runtime.settings.execution')}
          onChange={setExecutionEnabled}
        />
        <SwitchRow
          checked={values.publicExecutionEnabled}
          description={t('moduleApps.admin.runtime.settings.publicExecutionDescription')}
          label={t('moduleApps.admin.runtime.settings.publicExecution')}
          disabled={
            submitting ||
            !canWrite ||
            (!values.publicExecutionEnabled && (!values.executionEnabled || !publicConnectionReady))
          }
          onChange={(checked) => setValue('publicExecutionEnabled', checked)}
        />
        <SwitchRow
          checked={values.invocationEnabled}
          description={t('moduleApps.admin.runtime.settings.invocationDescription')}
          label={t('moduleApps.admin.runtime.settings.invocation')}
          disabled={
            submitting ||
            !canWrite ||
            (!values.invocationEnabled && (!values.executionEnabled || !internalConnectionReady))
          }
          onChange={(checked) => setValue('invocationEnabled', checked)}
        />
        <SwitchRow
          checked={values.scheduleDispatchEnabled}
          description={t('moduleApps.admin.runtime.settings.scheduleDescription')}
          label={t('moduleApps.admin.runtime.settings.schedule')}
          disabled={
            submitting || !canWrite || (!values.scheduleDispatchEnabled && !values.executionEnabled)
          }
          onChange={(checked) => setValue('scheduleDispatchEnabled', checked)}
        />
        <SwitchRow
          checked={values.workflowPrivilegedExecutorsEnabled}
          description={t('moduleApps.admin.runtime.settings.workflowDescription')}
          label={t('moduleApps.admin.runtime.settings.workflow')}
          disabled={
            submitting ||
            !canWrite ||
            (!values.workflowPrivilegedExecutorsEnabled && !values.executionEnabled)
          }
          onChange={(checked) => setValue('workflowPrivilegedExecutorsEnabled', checked)}
        />
      </div>
      <p className={styles.description}>{t('moduleApps.admin.runtime.settings.description')}</p>
      <div className={styles.actions}>
        <Button
          disabled={!canWrite || !dirty || submitting}
          icon={Save}
          loading={submitting}
          type="primary"
          onClick={() => void save()}
        >
          {t('moduleApps.admin.runtime.settings.save')}
        </Button>
        <Button
          disabled={!canWrite || !dirty || submitting}
          icon={RotateCcw}
          onClick={() => setValues(initialValues)}
        >
          {t('moduleApps.admin.runtime.settings.reset')}
        </Button>
      </div>
    </div>
  );
});

ModuleAppRuntimeSettings.displayName = 'ModuleAppRuntimeSettings';

export default ModuleAppRuntimeSettings;
