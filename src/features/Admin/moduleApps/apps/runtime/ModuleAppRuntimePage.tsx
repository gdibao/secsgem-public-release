'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight, Play, RefreshCw } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { ADMIN_BASE_PATH } from '@/features/Admin/adminCatalog';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ArtifactsTable from '../../ArtifactsTable';
import InstallsTable from '../../InstallsTable';
import { MODULE_ADMIN_ROUTE_PATHS } from '../../navigation/catalog';
import RecordsTable from '../../RecordsTable';
import RunsTable from '../../RunsTable';
import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import ModulePageState from '../../shared/ModulePageState';
import type {
  ModuleAppArtifactRow,
  ModuleAppInstallRow,
  ModuleAppRecordRow,
  ModuleAppRunRow,
  ModuleAppRuntimeDiagnostics,
} from '../../types';
import ModuleAppRuntimeSettings from './ModuleAppRuntimeSettings';

const styles = createStaticStyles(({ css, cssVar }) => ({
  diagnosticCode: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  diagnosticActions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    align-items: center;
  `,
  diagnosticAction: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorLink};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorLinkHover};
    }

    svg {
      flex: none;
    }
  `,
  diagnosticGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0 20px;
    margin: 0;
  `,
  diagnosticGroup: css`
    display: grid;
    gap: 10px;

    h3,
    p {
      margin: 0;
    }

    p {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  diagnosticItem: css`
    display: grid;
    gap: 6px;

    min-width: 0;
    margin: 0;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    dd {
      margin: 0;
    }
  `,
  diagnosticLabel: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  diagnosticStatus: css`
    display: inline-flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    width: fit-content;
    max-width: 100%;

    color: ${cssVar.colorText};

    &[data-tone='positive'] {
      color: ${cssVar.colorSuccess};
    }

    &[data-tone='warning'] {
      color: ${cssVar.colorWarning};
    }

    &[data-tone='negative'] {
      color: ${cssVar.colorError};
    }
  `,
  diagnosticStatusDot: css`
    flex: none;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: currentcolor;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  `,
  page: css`
    display: grid;
    gap: 20px;
    max-width: 1180px;
  `,
  section: css`
    display: grid;
    gap: 10px;
    padding-block: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

type ListResponse<T> = { items?: T[]; nextCursor?: null | string };

type RuntimeSectionProps<T> = {
  children: ReactNode;
  data?: ListResponse<T>;
  emptyDescription: string;
  emptyTitle: string;
  error?: unknown;
  href: string;
  isLoading?: boolean;
  onRetry: () => void;
  testId: string;
  title: string;
};

const RuntimeSection = <T,>({
  children,
  data,
  emptyDescription,
  emptyTitle,
  error,
  href,
  isLoading,
  onRetry,
  testId,
  title,
}: RuntimeSectionProps<T>) => (
  <section className={styles.section} data-testid={testId}>
    <header className={styles.header}>
      <h2>{title}</h2>
      <Link to={href}>{title}</Link>
    </header>
    <ModulePageState
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      error={error}
      isEmpty={!isLoading && !error && (data?.items?.length ?? 0) === 0}
      loading={isLoading}
      onRetry={onRetry}
    >
      {children}
    </ModulePageState>
  </section>
);

type DiagnosticTone = 'negative' | 'neutral' | 'positive' | 'warning';

const DiagnosticStatus = ({ label, tone }: { label: string; tone: DiagnosticTone }) => (
  <span className={styles.diagnosticStatus} data-tone={tone}>
    <span aria-hidden className={styles.diagnosticStatusDot} />
    {label}
  </span>
);

const ModuleAppRuntimePage = memo(() => {
  const { t: translate } = useTranslation('common');
  const t = (key: string, options?: Record<string, unknown>) =>
    translate(key as any, options as any);
  const { appId } = useParams<{ appId: string }>();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite);
  const [dispatchingSchedules, setDispatchingSchedules] = useState(false);
  const runtimeSettingsKey = appId ? ADMIN_SETTINGS_SECTION_SWR_KEY('module-runtime') : null;
  const diagnosticsKey = appId ? moduleAppCacheKeys.runtimeDiagnostics() : null;
  const installsKey = appId ? moduleAppCacheKeys.runtime('installs', appId, 10) : null;
  const recordsKey = appId ? moduleAppCacheKeys.runtime('records', appId, 10) : null;
  const runsKey = appId ? moduleAppCacheKeys.runtime('runs', appId, 10) : null;
  const artifactsKey = appId ? moduleAppCacheKeys.runtime('artifacts', appId, 10) : null;
  const installs = useClientDataSWR<ListResponse<ModuleAppInstallRow>>(
    installsKey,
    () =>
      adminCommercialService.moduleApps.listInstalls({
        appId: appId!,
        cursor: undefined,
        limit: 10,
      }) as Promise<ListResponse<ModuleAppInstallRow>>,
  );
  const records = useClientDataSWR<ListResponse<ModuleAppRecordRow>>(
    recordsKey,
    () =>
      adminCommercialService.moduleApps.listRecords({
        appId: appId!,
        cursor: undefined,
        limit: 10,
      }) as Promise<ListResponse<ModuleAppRecordRow>>,
  );
  const runs = useClientDataSWR<ListResponse<ModuleAppRunRow>>(
    runsKey,
    () =>
      adminCommercialService.moduleApps.listRuns({
        appId: appId!,
        cursor: undefined,
        limit: 10,
      }) as Promise<ListResponse<ModuleAppRunRow>>,
  );
  const artifacts = useClientDataSWR<ListResponse<ModuleAppArtifactRow>>(
    artifactsKey,
    () =>
      adminCommercialService.moduleApps.listArtifacts({
        appId: appId!,
        cursor: undefined,
        limit: 10,
      }) as Promise<ListResponse<ModuleAppArtifactRow>>,
  );
  const runtimeSettings = useClientDataSWR(runtimeSettingsKey, () =>
    adminCommercialService.getSettingsSection('module-runtime'),
  );
  const diagnostics = useClientDataSWR<ModuleAppRuntimeDiagnostics>(diagnosticsKey, () =>
    adminCommercialService.moduleApps.getRuntimeDiagnostics(),
  );

  const confirmScheduleDispatch = () => {
    confirmModal({
      content: t('moduleApps.admin.runtime.diagnostics.dispatchNowConfirm'),
      okText: t('moduleApps.admin.runtime.diagnostics.dispatchNow'),
      title: t('moduleApps.admin.runtime.diagnostics.dispatchNow'),
      onOk: async () => {
        setDispatchingSchedules(true);
        try {
          const result = await adminCommercialService.moduleApps.dispatchSchedulesNow();
          const failed = result.failed + result.bookkeepingFailed;
          const message = t(
            failed > 0
              ? 'moduleApps.admin.runtime.diagnostics.dispatchNowPartial'
              : 'moduleApps.admin.runtime.diagnostics.dispatchNowSuccess',
            { claimed: result.claimed, dispatched: result.dispatched, failed },
          );
          if (failed > 0) toast.warning(message);
          else toast.success(message);
          if (diagnosticsKey) await mutate(diagnosticsKey);
        } catch (error) {
          toast.error(
            t(
              error instanceof Error && error.message === 'MODULE_APP_SCHEDULE_DISPATCH_DISABLED'
                ? 'moduleApps.admin.runtime.diagnostics.dispatchNowDisabled'
                : 'moduleApps.admin.runtime.diagnostics.dispatchNowFailed',
            ),
          );
        } finally {
          setDispatchingSchedules(false);
        }
      },
    });
  };

  if (!appId) return <p>{t('moduleApps.admin.operations.selectAppDescription')}</p>;

  const globalPath = (
    routeId: 'module-artifacts' | 'module-installs' | 'module-records' | 'module-runs',
  ) => `${MODULE_ADMIN_ROUTE_PATHS[routeId]}?appId=${encodeURIComponent(appId)}`;
  const enabledStatus = (enabled: boolean) => ({
    label: t(
      enabled
        ? 'moduleApps.admin.runtime.diagnostics.status.enabled'
        : 'moduleApps.admin.runtime.diagnostics.status.disabled',
    ),
    tone: (enabled ? 'positive' : 'neutral') as DiagnosticTone,
  });
  const configuredStatus = (configured: boolean) => ({
    label: t(
      configured
        ? 'moduleApps.admin.runtime.diagnostics.status.configured'
        : 'moduleApps.admin.runtime.diagnostics.status.missing',
    ),
    tone: (configured ? 'positive' : 'warning') as DiagnosticTone,
  });
  const unavailableStatus = () => ({
    label: t('moduleApps.admin.runtime.diagnostics.status.unavailable'),
    tone: 'negative' as DiagnosticTone,
  });
  const countStatus = (
    value: null | number | undefined,
    tone: (value: number) => DiagnosticTone,
  ) =>
    value === null || value === undefined
      ? unavailableStatus()
      : { label: new Intl.NumberFormat().format(value), tone: tone(value) };
  const formatDiagnosticDate = (value: Date | null | string | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return null;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };
  const probeStatus = diagnostics.data
    ? {
        label: t(`moduleApps.admin.runtime.diagnostics.status.${diagnostics.data.probe.status}`),
        tone: (diagnostics.data.probe.status === 'ready'
          ? 'positive'
          : diagnostics.data.probe.status === 'unavailable'
            ? 'negative'
            : 'neutral') as DiagnosticTone,
      }
    : undefined;
  const enabledChatModelCount = diagnostics.data?.platformGateways.ai.enabledChatModelCount ?? 0;
  const paymentMethods = diagnostics.data?.platformGateways.payments.methods ?? [];
  const paymentMethodStatus = {
    label:
      paymentMethods.length > 0
        ? paymentMethods.map((method) => t(`moduleApps.purchase.methods.${method}`)).join(', ')
        : t('moduleApps.admin.runtime.diagnostics.status.missing'),
    tone: (paymentMethods.length > 0 ? 'positive' : 'warning') as DiagnosticTone,
  };
  const paymentSource = diagnostics.data?.platformGateways.payments.source;
  const paymentSourceStatus = {
    label: paymentSource?.backendManaged
      ? t('moduleApps.admin.runtime.diagnostics.paymentSource.backend')
      : t('moduleApps.admin.runtime.diagnostics.paymentSource.legacyEnvironment', {
          count: paymentSource?.legacyEnvironmentKeyCount ?? 0,
        }),
    tone: (paymentSource?.backendManaged ? 'positive' : 'warning') as DiagnosticTone,
  };
  const scheduler = diagnostics.data?.scheduler;
  const schedulerDiagnosticRows = diagnostics.data
    ? [
        {
          label: t('moduleApps.admin.runtime.diagnostics.schedulerStatus'),
          status:
            scheduler?.status === 'available'
              ? {
                  label: t('moduleApps.admin.runtime.diagnostics.status.available'),
                  tone: 'positive' as DiagnosticTone,
                }
              : unavailableStatus(),
        },
        ...(scheduler?.status === 'available'
          ? [
              {
                label: t('moduleApps.admin.runtime.diagnostics.enabledSchedules'),
                status: countStatus(scheduler.enabledSchedules, () => 'neutral'),
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.claimableSchedules'),
                status: countStatus(scheduler.claimableSchedules, (value) =>
                  value > 0 ? 'warning' : 'positive',
                ),
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.activeClaims'),
                status: countStatus(scheduler.activeClaims, () => 'neutral'),
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.staleClaims'),
                status: countStatus(scheduler.staleClaims, (value) =>
                  value > 0 ? 'negative' : 'positive',
                ),
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.oldestClaimableAt'),
                status: scheduler.oldestClaimableAt
                  ? {
                      label:
                        formatDiagnosticDate(scheduler.oldestClaimableAt) ??
                        t('moduleApps.admin.runtime.diagnostics.status.unavailable'),
                      tone: 'warning' as DiagnosticTone,
                    }
                  : {
                      label: t('moduleApps.admin.runtime.diagnostics.status.noBacklog'),
                      tone: 'positive' as DiagnosticTone,
                    },
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.lastScheduledRunAt'),
                status: scheduler.lastScheduledRunAt
                  ? {
                      label:
                        formatDiagnosticDate(scheduler.lastScheduledRunAt) ??
                        t('moduleApps.admin.runtime.diagnostics.status.unavailable'),
                      tone: 'neutral' as DiagnosticTone,
                    }
                  : {
                      label: t('moduleApps.admin.runtime.diagnostics.status.never'),
                      tone: 'warning' as DiagnosticTone,
                    },
              },
              {
                label: t('moduleApps.admin.runtime.diagnostics.failedScheduledRuns24h'),
                status: countStatus(scheduler.failedScheduledRuns24h, (value) =>
                  value > 0 ? 'negative' : 'positive',
                ),
              },
            ]
          : []),
      ]
    : [];
  const runtimeDiagnosticRows = diagnostics.data
    ? [
        {
          label: t('moduleApps.admin.runtime.diagnostics.probe'),
          status: probeStatus!,
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.execution'),
          status: enabledStatus(diagnostics.data.switches.executionEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.publicExecution'),
          status: enabledStatus(diagnostics.data.switches.publicExecutionEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.invocation'),
          status: enabledStatus(diagnostics.data.switches.invocationEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.scheduleDispatch'),
          status: enabledStatus(diagnostics.data.switches.scheduleDispatchEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.workflowExecutors'),
          status: enabledStatus(diagnostics.data.switches.workflowPrivilegedExecutorsEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.internalUrl'),
          status: configuredStatus(diagnostics.data.configuration.internalUrlConfigured),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.internalToken'),
          status: configuredStatus(diagnostics.data.configuration.internalTokenConfigured),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.publicOrigin'),
          status: configuredStatus(diagnostics.data.configuration.publicOriginConfigured),
        },
      ]
    : [];
  const gatewayDiagnosticRows = diagnostics.data
    ? [
        {
          label: t('moduleApps.admin.runtime.diagnostics.managedAiModels'),
          status: {
            label: t('moduleApps.admin.runtime.diagnostics.enabledChatModels', {
              count: enabledChatModelCount,
            }),
            tone: (enabledChatModelCount > 0 ? 'positive' : 'warning') as DiagnosticTone,
          },
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.paymentGateway'),
          status: configuredStatus(diagnostics.data.platformGateways.payments.configured),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.paymentConfigurationSource'),
          status: paymentSourceStatus,
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.paymentSystem'),
          status: enabledStatus(diagnostics.data.platformGateways.payments.enabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.modulePayments'),
          status: enabledStatus(diagnostics.data.platformGateways.payments.moduleAppEnabled),
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.paymentMethods'),
          status: paymentMethodStatus,
        },
        {
          label: t('moduleApps.admin.runtime.diagnostics.paymentCallbackOrigin'),
          status: configuredStatus(
            diagnostics.data.platformGateways.payments.publicOriginConfigured,
          ),
        },
      ]
    : [];

  return (
    <section className={styles.page} data-testid="module-app-runtime">
      <header>
        <h1>{t('moduleApps.admin.runtime.title')}</h1>
        <p>{t('moduleApps.admin.runtime.description')}</p>
      </header>
      <section className={styles.section} data-testid="module-runtime-control-center">
        <header>
          <h2>{t('moduleApps.admin.runtime.settings.title')}</h2>
          <p>{t('moduleApps.admin.runtime.settings.subtitle')}</p>
        </header>
        <ModulePageState
          emptyDescription={t('moduleApps.admin.runtime.settings.subtitle')}
          emptyTitle={t('moduleApps.admin.runtime.settings.title')}
          error={runtimeSettings.error}
          isEmpty={false}
          loading={runtimeSettings.isLoading}
          onRetry={() => runtimeSettingsKey && void mutate(runtimeSettingsKey)}
        >
          {runtimeSettings.data?.moduleAppRuntimeConfig ? (
            <ModuleAppRuntimeSettings
              canWrite={canWrite}
              settings={runtimeSettings.data.moduleAppRuntimeConfig}
            />
          ) : null}
        </ModulePageState>
      </section>
      <section className={styles.section} data-testid="module-runtime-diagnostics">
        <header className={styles.header}>
          <div>
            <h2>{t('moduleApps.admin.runtime.diagnostics.title')}</h2>
            <p>{t('moduleApps.admin.runtime.diagnostics.description')}</p>
          </div>
          <Button
            icon={RefreshCw}
            title={t('moduleApps.admin.runtime.diagnostics.refresh')}
            onClick={() => diagnosticsKey && void mutate(diagnosticsKey)}
          />
        </header>
        <ModulePageState
          emptyDescription={t('moduleApps.admin.runtime.diagnostics.emptyDescription')}
          emptyTitle={t('moduleApps.admin.runtime.diagnostics.emptyTitle')}
          error={diagnostics.error}
          isEmpty={!diagnostics.isLoading && !diagnostics.error && !diagnostics.data}
          loading={diagnostics.isLoading}
          onRetry={() => diagnosticsKey && void mutate(diagnosticsKey)}
        >
          {diagnostics.data ? (
            <>
              <dl className={styles.diagnosticGrid}>
                {runtimeDiagnosticRows.map((item) => (
                  <div className={styles.diagnosticItem} key={item.label}>
                    <dt className={styles.diagnosticLabel}>{item.label}</dt>
                    <dd>
                      <DiagnosticStatus {...item.status} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className={styles.diagnosticGroup}>
                <header className={styles.header}>
                  <div>
                    <h3>{t('moduleApps.admin.runtime.diagnostics.schedulerTitle')}</h3>
                    <p>{t('moduleApps.admin.runtime.diagnostics.schedulerDescription')}</p>
                  </div>
                  {canWrite ? (
                    <Button
                      icon={Play}
                      loading={dispatchingSchedules}
                      disabled={
                        dispatchingSchedules || !diagnostics.data.switches.scheduleDispatchEnabled
                      }
                      title={
                        diagnostics.data.switches.scheduleDispatchEnabled
                          ? t('moduleApps.admin.runtime.diagnostics.dispatchNow')
                          : t('moduleApps.admin.runtime.diagnostics.dispatchNowDisabled')
                      }
                      onClick={confirmScheduleDispatch}
                    >
                      {t('moduleApps.admin.runtime.diagnostics.dispatchNow')}
                    </Button>
                  ) : null}
                </header>
                <dl className={styles.diagnosticGrid}>
                  {schedulerDiagnosticRows.map((item) => (
                    <div className={styles.diagnosticItem} key={item.label}>
                      <dt className={styles.diagnosticLabel}>{item.label}</dt>
                      <dd>
                        <DiagnosticStatus {...item.status} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={styles.diagnosticGroup}>
                <header>
                  <h3>{t('moduleApps.admin.runtime.diagnostics.platformGatewaysTitle')}</h3>
                  <p>{t('moduleApps.admin.runtime.diagnostics.platformGatewaysDescription')}</p>
                </header>
                <dl className={styles.diagnosticGrid}>
                  {gatewayDiagnosticRows.map((item) => (
                    <div className={styles.diagnosticItem} key={item.label}>
                      <dt className={styles.diagnosticLabel}>{item.label}</dt>
                      <dd>
                        <DiagnosticStatus {...item.status} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <nav
                  aria-label={t('moduleApps.admin.runtime.diagnostics.gatewayManagement')}
                  className={styles.diagnosticActions}
                >
                  <Link className={styles.diagnosticAction} to={`${ADMIN_BASE_PATH}/providers`}>
                    {t('moduleApps.admin.runtime.diagnostics.manageProviders')}
                    <ArrowRight aria-hidden size={15} />
                  </Link>
                  <Link className={styles.diagnosticAction} to={`${ADMIN_BASE_PATH}/payments`}>
                    {t('moduleApps.admin.runtime.diagnostics.managePayments')}
                    <ArrowRight aria-hidden size={15} />
                  </Link>
                </nav>
              </div>
              {diagnostics.data.probe.status === 'unavailable' ? (
                <p className={styles.diagnosticCode} role="status">
                  {t('moduleApps.admin.runtime.diagnostics.failureCode', {
                    code: diagnostics.data.probe.code,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
        </ModulePageState>
      </section>
      <RuntimeSection
        data={installs.data}
        emptyDescription={t('moduleApps.admin.runtime.emptyDescription')}
        emptyTitle={t('moduleApps.admin.runtime.emptyTitle')}
        error={installs.error}
        href={globalPath('module-installs')}
        isLoading={installs.isLoading}
        testId="module-runtime-installs"
        title={t('moduleApps.admin.runtime.installs')}
        onRetry={() => installsKey && void mutate(installsKey)}
      >
        <InstallsTable
          items={installs.data?.items}
          labels={{
            install: t('moduleApps.admin.operations.installs.columns.install'),
            installed: t('moduleApps.admin.operations.installs.columns.installed'),
            scope: t('moduleApps.admin.operations.installs.columns.scope'),
            status: t('moduleApps.admin.operations.installs.columns.status'),
            user: t('moduleApps.admin.operations.installs.columns.user'),
            workspace: t('moduleApps.admin.operations.installs.columns.workspace'),
          }}
        />
      </RuntimeSection>
      <RuntimeSection
        data={records.data}
        emptyDescription={t('moduleApps.admin.runtime.emptyDescription')}
        emptyTitle={t('moduleApps.admin.runtime.emptyTitle')}
        error={records.error}
        href={globalPath('module-records')}
        isLoading={records.isLoading}
        testId="module-runtime-records"
        title={t('moduleApps.admin.runtime.records')}
        onRetry={() => recordsKey && void mutate(recordsKey)}
      >
        <RecordsTable
          items={records.data?.items}
          labels={{
            collection: t('moduleApps.admin.operations.records.columns.collection'),
            record: t('moduleApps.admin.operations.records.columns.record'),
            scope: t('moduleApps.admin.operations.records.columns.scope'),
            status: t('moduleApps.admin.operations.records.columns.status'),
            updated: t('moduleApps.admin.operations.records.columns.updated'),
          }}
        />
      </RuntimeSection>
      <RuntimeSection
        data={runs.data}
        emptyDescription={t('moduleApps.admin.runtime.emptyDescription')}
        emptyTitle={t('moduleApps.admin.runtime.emptyTitle')}
        error={runs.error}
        href={globalPath('module-runs')}
        isLoading={runs.isLoading}
        testId="module-runtime-runs"
        title={t('moduleApps.admin.runtime.runs')}
        onRetry={() => runsKey && void mutate(runsKey)}
      >
        <RunsTable
          items={runs.data?.items}
          labels={{
            action: t('moduleApps.admin.operations.runs.columns.action'),
            created: t('moduleApps.admin.operations.runs.columns.created'),
            duration: t('moduleApps.admin.operations.runs.columns.duration'),
            error: t('moduleApps.admin.operations.runs.columns.error'),
            run: t('moduleApps.admin.operations.runs.columns.run'),
            status: t('moduleApps.admin.operations.runs.columns.status'),
          }}
        />
      </RuntimeSection>
      <RuntimeSection
        data={artifacts.data}
        emptyDescription={t('moduleApps.admin.runtime.emptyDescription')}
        emptyTitle={t('moduleApps.admin.runtime.emptyTitle')}
        error={artifacts.error}
        href={globalPath('module-artifacts')}
        isLoading={artifacts.isLoading}
        testId="module-runtime-artifacts"
        title={t('moduleApps.admin.runtime.artifacts')}
        onRetry={() => artifactsKey && void mutate(artifactsKey)}
      >
        <ArtifactsTable
          items={artifacts.data?.items}
          labels={{
            artifact: t('moduleApps.admin.operations.artifacts.columns.artifact'),
            file: t('moduleApps.admin.operations.artifacts.columns.file'),
            mime: t('moduleApps.admin.operations.artifacts.columns.mime'),
            scope: t('moduleApps.admin.operations.artifacts.columns.scope'),
            size: t('moduleApps.admin.operations.artifacts.columns.size'),
            storageKey: t('moduleApps.admin.operations.artifacts.columns.storageKey'),
          }}
        />
      </RuntimeSection>
    </section>
  );
});

ModuleAppRuntimePage.displayName = 'ModuleAppRuntimePage';

export default ModuleAppRuntimePage;
