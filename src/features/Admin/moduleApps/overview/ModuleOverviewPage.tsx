'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight, ClipboardCheck, CreditCard, PackageCheck, Play } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { MODULE_ADMIN_ROUTE_PATHS } from '../navigation/catalog';
import type { ModuleAppPaymentDiagnosticRow } from '../PaymentReconciliationTable';
import { moduleAppCacheKeys } from '../shared/cacheKeys';
import ModulePageState from '../shared/ModulePageState';
import { setFilter } from '../shared/queryState';
import type { AdminModuleAppItem, AdminModuleAppPackageRow, ModuleAppRunRow } from '../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  band: css`
    display: grid;
    gap: 12px;

    padding-block: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  bandHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  `,
  bandTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;

    margin: 0;

    font-size: 16px;
    font-weight: 600;
    line-height: 24px;
    color: ${cssVar.colorText};
  `,
  control: css`
    display: grid;
    gap: 6px;
    max-width: 360px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  link: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  list: css`
    display: grid;
    gap: 0;
  `,
  page: css`
    display: grid;
    gap: 4px;
    max-width: 1180px;
  `,
  row: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: baseline;

    min-height: 44px;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  rowLink: css`
    flex: 1 1 220px;

    min-width: 0;

    overflow: hidden;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  `,
  secondary: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

type ListResponse<T> = { items?: T[]; nextCursor?: null | string };

export interface ModuleOverviewPageProps {
  canReadFinance?: boolean;
  canReadModules?: boolean;
}

const appPath = (appId: string) =>
  MODULE_ADMIN_ROUTE_PATHS['module-app-overview'].replace(':appId', encodeURIComponent(appId));

const paymentPath = `${MODULE_ADMIN_ROUTE_PATHS['module-payments']}?discrepancyStatus=open`;

const statusTranslationKeys: Record<string, string> = {
  denied: 'moduleApps.admin.center.overview.status.denied',
  draft: 'moduleApps.admin.center.overview.status.draft',
  failed: 'moduleApps.admin.center.overview.status.failed',
  pending_review: 'moduleApps.admin.center.overview.status.pendingReview',
  published: 'moduleApps.admin.center.overview.status.published',
  queued: 'moduleApps.admin.center.overview.status.queued',
  running: 'moduleApps.admin.center.overview.status.running',
  succeeded: 'moduleApps.admin.center.overview.status.succeeded',
  unpublished: 'moduleApps.admin.center.overview.status.unpublished',
};

const ModuleOverviewBand = ({
  children,
  icon,
  link,
  linkLabel,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  link: string;
  linkLabel: string;
  title: string;
}) => (
  <section className={styles.band}>
    <div className={styles.bandHeader}>
      <h2 className={styles.bandTitle}>
        {icon}
        {title}
      </h2>
      <Link className={styles.link} to={link}>
        <span>{linkLabel}</span>
        <ArrowRight aria-hidden size={14} />
      </Link>
    </div>
    {children}
  </section>
);

const ModuleOverviewPage = memo<ModuleOverviewPageProps>(
  ({ canReadFinance: canReadFinanceOverride, canReadModules: canReadModulesOverride }) => {
    const { t: translate } = useTranslation('common');
    const t = (key: string) => translate(key as any);
    const [searchParams, setSearchParams] = useSearchParams();
    const role = useUserStore(
      (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
    );
    const canReadFinance =
      canReadFinanceOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.financeRead);
    const canReadModules =
      canReadModulesOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppRead);
    const selectedAppId = searchParams.get('appId') ?? '';

    const appsKey = canReadModules ? moduleAppCacheKeys.apps('overview:updated_desc') : null;
    const packagesKey = canReadModules ? moduleAppCacheKeys.packages('pending_review') : null;
    const paymentsKey = canReadFinance
      ? moduleAppCacheKeys.payments('overview:discrepancyStatus=open')
      : null;
    const runsKey =
      canReadModules && selectedAppId ? moduleAppCacheKeys.runtime('runs', selectedAppId, 5) : null;

    const apps = useClientDataSWR<ListResponse<AdminModuleAppItem>>(
      appsKey,
      () =>
        adminCommercialService.moduleApps.list({ limit: 5, sort: 'updated_desc' }) as Promise<
          ListResponse<AdminModuleAppItem>
        >,
    );
    const packages = useClientDataSWR<ListResponse<AdminModuleAppPackageRow>>(
      packagesKey,
      () =>
        adminCommercialService.moduleApps.listPackages({
          limit: 5,
          reviewStatus: 'pending_review',
        }) as Promise<ListResponse<AdminModuleAppPackageRow>>,
    );
    const payments = useClientDataSWR<ListResponse<ModuleAppPaymentDiagnosticRow>>(
      paymentsKey,
      () =>
        adminCommercialService.moduleApps.listPaymentDiagnostics({
          discrepancyStatus: 'open',
          limit: 5,
        }) as Promise<ListResponse<ModuleAppPaymentDiagnosticRow>>,
    );
    const runs = useClientDataSWR<ListResponse<ModuleAppRunRow>>(
      runsKey,
      () =>
        adminCommercialService.moduleApps.listRuns({ appId: selectedAppId, limit: 5 }) as Promise<
          ListResponse<ModuleAppRunRow>
        >,
    );

    const appItems = apps.data?.items ?? [];
    const appOptions = appItems.map((app) => ({ label: app.displayName, value: app.id }));
    if (selectedAppId && !appOptions.some((option) => option.value === selectedAppId)) {
      appOptions.unshift({ label: selectedAppId, value: selectedAppId });
    }
    const selectApp = (value: string) =>
      setSearchParams((current) => setFilter(current, 'appId', value || undefined));
    const packageItems = packages.data?.items ?? [];
    const paymentItems = payments.data?.items ?? [];
    const runItems = runs.data?.items ?? [];
    const statusLabel = (status: string) =>
      statusTranslationKeys[status] ? t(statusTranslationKeys[status]) : status;

    return (
      <section className={styles.page} data-testid="module-overview-page">
        <header>
          <h1>{t('moduleApps.admin.center.overview.title')}</h1>
          <p>{t('moduleApps.admin.center.overview.description')}</p>
        </header>

        {canReadModules ? (
          <>
            <ModuleOverviewBand
              icon={<PackageCheck aria-hidden size={18} />}
              link={MODULE_ADMIN_ROUTE_PATHS['module-reviews']}
              linkLabel={t('moduleApps.admin.center.overview.viewAll')}
              title={t('moduleApps.admin.center.overview.pendingPackages')}
            >
              <ModulePageState
                emptyTitle={t('moduleApps.admin.center.overview.pendingPackagesEmptyTitle')}
                error={packages.error}
                isEmpty={!packages.isLoading && !packages.error && packageItems.length === 0}
                loading={packages.isLoading}
                loadingLabel={t('moduleApps.admin.center.overview.loading')}
                emptyDescription={t(
                  'moduleApps.admin.center.overview.pendingPackagesEmptyDescription',
                )}
                onRetry={() => packagesKey && mutate(packagesKey)}
              >
                <div className={styles.list}>
                  {packageItems.map((item) => {
                    const displayName =
                      item.manifestSnapshot?.app?.displayName ??
                      item.manifestSnapshot?.app?.slug ??
                      item.id;
                    return (
                      <div className={styles.row} key={item.id}>
                        <Link
                          className={styles.rowLink}
                          to={MODULE_ADMIN_ROUTE_PATHS['module-reviews']}
                        >
                          {displayName}
                        </Link>
                        <span className={styles.secondary}>{statusLabel(item.reviewStatus)}</span>
                      </div>
                    );
                  })}
                </div>
              </ModulePageState>
            </ModuleOverviewBand>

            <ModuleOverviewBand
              icon={<ClipboardCheck aria-hidden size={18} />}
              link={MODULE_ADMIN_ROUTE_PATHS['module-apps']}
              linkLabel={t('moduleApps.admin.center.overview.viewAll')}
              title={t('moduleApps.admin.center.overview.recentApps')}
            >
              <div className={styles.control}>
                <label htmlFor="module-overview-app">
                  {t('moduleApps.admin.center.overview.appSelector')}
                </label>
                <Select
                  id="module-overview-app"
                  value={selectedAppId}
                  options={[
                    {
                      label: t('moduleApps.admin.center.overview.selectApp'),
                      value: '',
                    },
                    ...appOptions,
                  ]}
                  onChange={(value) => selectApp(String(value ?? ''))}
                />
              </div>
              <ModulePageState
                emptyDescription={t('moduleApps.admin.center.overview.recentAppsEmptyDescription')}
                emptyTitle={t('moduleApps.admin.center.overview.recentAppsEmptyTitle')}
                error={apps.error}
                isEmpty={!apps.isLoading && !apps.error && appItems.length === 0}
                loading={apps.isLoading}
                loadingLabel={t('moduleApps.admin.center.overview.loading')}
                onRetry={() => appsKey && mutate(appsKey)}
              >
                <div className={styles.list}>
                  {appItems.map((app) => (
                    <div className={styles.row} key={app.id}>
                      <Link className={styles.rowLink} to={appPath(app.id)}>
                        {app.displayName}
                      </Link>
                      <span className={styles.secondary}>{statusLabel(app.status)}</span>
                    </div>
                  ))}
                </div>
              </ModulePageState>
            </ModuleOverviewBand>

            {selectedAppId ? (
              <ModuleOverviewBand
                icon={<Play aria-hidden size={18} />}
                link={`${MODULE_ADMIN_ROUTE_PATHS['module-runs']}?appId=${encodeURIComponent(selectedAppId)}`}
                linkLabel={t('moduleApps.admin.center.overview.viewAll')}
                title={t('moduleApps.admin.center.overview.recentRuns')}
              >
                <ModulePageState
                  emptyTitle={t('moduleApps.admin.center.overview.recentRunsEmptyTitle')}
                  error={runs.error}
                  isEmpty={!runs.isLoading && !runs.error && runItems.length === 0}
                  loading={runs.isLoading}
                  loadingLabel={t('moduleApps.admin.center.overview.loading')}
                  emptyDescription={t(
                    'moduleApps.admin.center.overview.recentRunsEmptyDescription',
                  )}
                  onRetry={() => runsKey && mutate(runsKey)}
                >
                  <div className={styles.list}>
                    {runItems.map((run) => (
                      <div className={styles.row} key={run.id}>
                        <Link
                          className={styles.rowLink}
                          to={`${MODULE_ADMIN_ROUTE_PATHS['module-runs']}?appId=${encodeURIComponent(selectedAppId)}`}
                        >
                          {run.id}
                        </Link>
                        <span className={styles.secondary}>{statusLabel(run.status)}</span>
                      </div>
                    ))}
                  </div>
                </ModulePageState>
              </ModuleOverviewBand>
            ) : null}
          </>
        ) : null}

        {canReadFinance ? (
          <ModuleOverviewBand
            icon={<CreditCard aria-hidden size={18} />}
            link={paymentPath}
            linkLabel={t('moduleApps.admin.center.overview.viewAll')}
            title={t('moduleApps.admin.center.overview.openDiscrepancies')}
          >
            <ModulePageState
              emptyTitle={t('moduleApps.admin.center.overview.openDiscrepanciesEmptyTitle')}
              error={payments.error}
              isEmpty={!payments.isLoading && !payments.error && paymentItems.length === 0}
              loading={payments.isLoading}
              loadingLabel={t('moduleApps.admin.center.overview.loading')}
              emptyDescription={t(
                'moduleApps.admin.center.overview.openDiscrepanciesEmptyDescription',
              )}
              onRetry={() => paymentsKey && mutate(paymentsKey)}
            >
              <div className={styles.list}>
                {paymentItems.map((payment) => (
                  <div className={styles.row} key={payment.id}>
                    <Link className={styles.rowLink} to={paymentPath}>
                      {payment.appName} / {payment.orderId}
                    </Link>
                    <span className={styles.secondary}>
                      {payment.totalAmount} {payment.currency}
                    </span>
                  </div>
                ))}
              </div>
            </ModulePageState>
          </ModuleOverviewBand>
        ) : null}
      </section>
    );
  },
);

ModuleOverviewPage.displayName = 'ModuleOverviewPage';

export default ModuleOverviewPage;
