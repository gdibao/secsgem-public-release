'use client';

import type {
  ModuleAppDeveloperAppSummary,
  ModuleAppDeveloperPackageSummary,
  ModuleAppDeveloperPayoutListResult,
  ModuleAppDeveloperPublisherProfile,
  ModuleAppDeveloperRevenueListResult,
  ModuleAppDeveloperRevenueSummary,
  ModuleAppDeveloperVersionSummary,
} from '@lobechat/types';
import { Icon, Skeleton, Text } from '@lobehub/ui';
import { Button, confirmModal, Input, Tabs, toast } from '@lobehub/ui/base-ui';
import { EyeOff, RefreshCw, Rocket, RotateCcw } from 'lucide-react';
import { type FormEvent, memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import useSWR from 'swr';

import ModuleAppPackageUploader from '@/features/ModuleAppMarket/PackageUploader';
import { moduleAppService } from '@/services/moduleApp';

import { styles } from './styles';

const statusClass = (status: string) =>
  [
    styles.status,
    [
      'approved',
      'clean',
      'paid',
      'published',
      'ready',
      'settled',
      'succeeded',
      'verified',
    ].includes(status)
      ? styles.statusGood
      : ['blocked', 'failed', 'rejected', 'reversed', 'suspended'].includes(status)
        ? styles.statusBad
        : '',
  ]
    .filter(Boolean)
    .join(' ');

const Status = ({ value }: { value: string }) => {
  const { t } = useTranslation('common');
  return (
    <span className={statusClass(value)}>
      {t(['moduleApps.developer.status.', value].join('') as any, value)}
    </span>
  );
};

const ResourceError = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <div className={styles.section} role="alert">
      <div className={styles.error}>{t('moduleApps.developer.loadError')}</div>
      <div>
        <Button onClick={onRetry}>{t('moduleApps.developer.retry')}</Button>
      </div>
    </div>
  );
};

const PaginationControls = ({
  canNext,
  canPrevious,
  loading,
  onNext,
  onPrevious,
}: {
  canNext: boolean;
  canPrevious: boolean;
  loading?: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) => {
  const { t } = useTranslation('common');
  if (!canNext && !canPrevious) return null;

  return (
    <div className={styles.actionRow}>
      <Button disabled={!canPrevious || loading} onClick={onPrevious}>
        {t('moduleApps.developer.previous')}
      </Button>
      <Button disabled={!canNext || loading} loading={loading} onClick={onNext}>
        {t('moduleApps.developer.next')}
      </Button>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: number | string }) => (
  <div className={styles.metric}>
    <div className={styles.metricValue}>{value}</div>
    <div className={styles.muted}>{label}</div>
  </div>
);

const PublisherProfile = memo<{
  onSaved: () => Promise<unknown>;
  profile: ModuleAppDeveloperPublisherProfile | null;
}>(({ onSaved, profile }) => {
  const { t } = useTranslation('common');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const suspended = profile?.status === 'suspended';

  useEffect(() => setDisplayName(profile?.displayName ?? ''), [profile?.displayName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await moduleAppService.upsertMyPublisherProfile({ displayName: displayName.trim() });
      await onSaved();
      toast.success(t('moduleApps.developer.profileSaved'));
    } catch {
      toast.error(t('moduleApps.developer.profileError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.section} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="module-app-publisher-name">
          {t('moduleApps.developer.publisherName')}
        </label>
        <Input
          disabled={suspended}
          id="module-app-publisher-name"
          maxLength={200}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <div className={styles.actionRow}>
        <Button
          disabled={suspended || !displayName.trim()}
          htmlType="submit"
          loading={saving}
          type="primary"
        >
          {t(profile ? 'moduleApps.developer.saveProfile' : 'moduleApps.developer.apply')}
        </Button>
        {profile ? <Status value={profile.status} /> : null}
      </div>
    </form>
  );
});
PublisherProfile.displayName = 'PublisherProfile';

const VersionList = memo<{
  app: ModuleAppDeveloperAppSummary;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}>(({ app, canManage, onChanged }) => {
  const { t } = useTranslation('common');
  const versions = useSWR<ModuleAppDeveloperVersionSummary[]>(
    ['moduleApp.listMyDeveloperVersions', app.id],
    () => moduleAppService.listMyDeveloperVersions({ appId: app.id }),
  );
  const [rollingBack, setRollingBack] = useState<string>();

  const performRollback = async (version: ModuleAppDeveloperVersionSummary) => {
    setRollingBack(version.id);
    try {
      await moduleAppService.rollbackMyDeveloperApp({ appId: app.id, versionId: version.id });
      await Promise.all([versions.mutate(), onChanged()]);
      toast.success(t('moduleApps.developer.rollbackSuccess'));
    } catch {
      toast.error(t('moduleApps.developer.actionError'));
    } finally {
      setRollingBack(undefined);
    }
  };
  const rollback = (version: ModuleAppDeveloperVersionSummary) => {
    confirmModal({
      content: t('moduleApps.developer.rollbackConfirm', { version: version.version }),
      okText: t('moduleApps.developer.rollback'),
      onOk: () => performRollback(version),
      title: t('moduleApps.developer.rollbackTitle'),
    });
  };

  if (versions.isLoading) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  if (versions.error) return <ResourceError onRetry={() => void versions.mutate()} />;

  return (
    <div className={styles.versionList}>
      {(versions.data ?? []).map((version) => (
        <div className={styles.row} key={version.id}>
          <div className={styles.sectionHeader}>
            <div className={styles.actionRow}>
              <strong>{version.version}</strong>
              {version.current ? <Status value={t('moduleApps.developer.current')} /> : null}
              {version.build ? <Status value={version.build.status} /> : null}
            </div>
            {canManage && !version.current && version.publishedAt ? (
              <Button
                icon={<Icon icon={RotateCcw} size={16} />}
                loading={rollingBack === version.id}
                onClick={() => rollback(version)}
              >
                {t('moduleApps.developer.rollback')}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
});
VersionList.displayName = 'VersionList';

const DeveloperAppRow = memo<{
  app: ModuleAppDeveloperAppSummary;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}>(({ app, canManage, onChanged }) => {
  const { t } = useTranslation('common');
  const [showVersions, setShowVersions] = useState(false);
  const [working, setWorking] = useState(false);
  const canPublish =
    app.latestPackage?.reviewStatus === 'approved' &&
    (!app.latestPackage.build || app.latestPackage.build.status === 'ready');

  const performPublicationChange = async () => {
    setWorking(true);
    try {
      if (app.status === 'published') {
        await moduleAppService.unpublishMyDeveloperApp({ appId: app.id });
      } else {
        await moduleAppService.publishMyDeveloperApp({ appId: app.id });
      }
      await onChanged();
      toast.success(t('moduleApps.developer.actionSuccess'));
    } catch {
      toast.error(t('moduleApps.developer.actionError'));
    } finally {
      setWorking(false);
    }
  };
  const togglePublication = () => {
    if (app.status !== 'published') {
      void performPublicationChange();
      return;
    }
    confirmModal({
      content: t('moduleApps.developer.unpublishConfirm'),
      okText: t('moduleApps.developer.unpublish'),
      onOk: performPublicationChange,
      title: t('moduleApps.developer.unpublishTitle'),
    });
  };

  return (
    <article className={styles.row}>
      <div className={styles.appHeader}>
        <div>
          <h3 className={styles.title}>{app.displayName}</h3>
          <div className={styles.muted}>{app.slug}</div>
        </div>
        <div className={styles.actionRow}>
          <Status value={app.status} />
          <Button
            disabled={!canManage || (app.status !== 'published' && !canPublish)}
            icon={<Icon icon={app.status === 'published' ? EyeOff : Rocket} size={16} />}
            loading={working}
            onClick={togglePublication}
          >
            {t(
              app.status === 'published'
                ? 'moduleApps.developer.unpublish'
                : 'moduleApps.developer.publish',
            )}
          </Button>
          <Button
            icon={<Icon icon={RefreshCw} size={16} />}
            onClick={() => setShowVersions((value) => !value)}
          >
            {t('moduleApps.developer.versions')}
          </Button>
        </div>
      </div>
      <div className={styles.subgrid}>
        <div>
          <div className={styles.muted}>{t('moduleApps.developer.latestVersion')}</div>
          <div>{app.latestVersion?.version ?? '-'}</div>
        </div>
        <div>
          <div className={styles.muted}>{t('moduleApps.developer.build')}</div>
          <div>{app.latestPackage?.build?.status ?? '-'}</div>
        </div>
        <div>
          <div className={styles.muted}>{t('moduleApps.developer.installations')}</div>
          <div>{app.metrics.activeInstallations}</div>
        </div>
        <div>
          <div className={styles.muted}>{t('moduleApps.developer.runs30d')}</div>
          <div>{app.metrics.totalRuns30d}</div>
        </div>
      </div>
      {showVersions ? <VersionList app={app} canManage={canManage} onChanged={onChanged} /> : null}
    </article>
  );
});
DeveloperAppRow.displayName = 'DeveloperAppRow';

const Applications = memo<{
  apps: ModuleAppDeveloperAppSummary[];
  canManage: boolean;
  onCreate: () => void;
  onChanged: () => Promise<unknown>;
}>(({ apps, canManage, onChanged, onCreate }) => {
  const { t } = useTranslation('common');
  const totals = useMemo(
    () =>
      apps.reduce(
        (value, app) => ({
          failed: value.failed + app.metrics.failedRuns30d,
          installs: value.installs + app.metrics.activeInstallations,
          runs: value.runs + app.metrics.totalRuns30d,
        }),
        { failed: 0, installs: 0, runs: 0 },
      ),
    [apps],
  );

  return (
    <div className={styles.section}>
      <div className={styles.metricGrid}>
        <Metric label={t('moduleApps.developer.apps')} value={apps.length} />
        <Metric label={t('moduleApps.developer.installations')} value={totals.installs} />
        <Metric label={t('moduleApps.developer.runs30d')} value={totals.runs} />
        <Metric label={t('moduleApps.developer.failedRuns30d')} value={totals.failed} />
      </div>
      {apps.length ? (
        <div>
          {apps.map((app) => (
            <DeveloperAppRow app={app} canManage={canManage} key={app.id} onChanged={onChanged} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <div>{t('moduleApps.developer.noApps')}</div>
          {canManage ? (
            <Button type="primary" onClick={onCreate}>
              {t('moduleApps.developer.submitFirstPackage')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
});
Applications.displayName = 'Applications';

const PackageRow = ({ item }: { item: ModuleAppDeveloperPackageSummary }) => (
  <div className={styles.row}>
    <div className={styles.sectionHeader}>
      <div>
        <strong>{item.appDisplayName}</strong>
        <div className={styles.muted}>
          {item.appSlug} · {item.packageVersion}
        </div>
      </div>
      <div className={styles.actionRow}>
        <Status value={item.reviewStatus} />
        <Status value={item.scanStatus} />
        {item.build ? <Status value={item.build.status} /> : null}
      </div>
    </div>
    {item.rejectionReason ? <div className={styles.error}>{item.rejectionReason}</div> : null}
    {item.build?.failureCode ? <div className={styles.error}>{item.build.failureCode}</div> : null}
    {item.validationReport.map((issue, index) => (
      <div
        className={issue.severity === 'error' ? styles.error : styles.muted}
        key={`${issue.code}-${index}`}
      >
        {issue.code}: {issue.message}
      </div>
    ))}
  </div>
);

const Submissions = memo<{
  items: ModuleAppDeveloperPackageSummary[];
  onSubmitted: () => Promise<void>;
  publisherVerified: boolean;
}>(({ items, onSubmitted, publisherVerified }) => {
  const { t } = useTranslation('common');
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>{t('moduleApps.developer.packages')}</h3>
        {publisherVerified ? <ModuleAppPackageUploader onSubmitted={onSubmitted} /> : null}
      </div>
      {items.length ? (
        items.map((item) => <PackageRow item={item} key={item.id} />)
      ) : (
        <div className={styles.empty}>{t('moduleApps.developer.noPackages')}</div>
      )}
    </div>
  );
});
Submissions.displayName = 'Submissions';

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { currency, style: 'currency' }).format(amount);

const FinanceSummary = memo<{ data: ModuleAppDeveloperRevenueSummary[] }>(({ data }) => {
  const { t } = useTranslation('common');
  return (
    <div className={styles.section}>
      {data.map((summary) => (
        <div className={styles.metricGrid} key={summary.currency}>
          <Metric
            label={t('moduleApps.developer.totalRevenue')}
            value={formatMoney(summary.totalAmount, summary.currency)}
          />
          <Metric
            label={t('moduleApps.developer.pendingRevenue')}
            value={formatMoney(summary.pendingAmount, summary.currency)}
          />
          <Metric
            label={t('moduleApps.developer.settledRevenue')}
            value={formatMoney(summary.settledAmount, summary.currency)}
          />
          <Metric label={t('moduleApps.developer.currency')} value={summary.currency} />
        </div>
      ))}
      {!data.length ? (
        <div className={styles.empty}>{t('moduleApps.developer.noRevenue')}</div>
      ) : null}
    </div>
  );
});
FinanceSummary.displayName = 'FinanceSummary';

const RevenueList = memo<{ data: ModuleAppDeveloperRevenueListResult }>(({ data }) => {
  const { t } = useTranslation('common');
  return (
    <div className={styles.section}>
      <h3 className={styles.title}>{t('moduleApps.developer.revenue')}</h3>
      {data.items.map((entry) => (
        <div className={styles.row} key={entry.id}>
          <div className={styles.sectionHeader}>
            <span>{formatMoney(entry.developerAmount, entry.currency)}</span>
            <Status value={entry.status} />
          </div>
          <div className={styles.muted}>
            {t(['moduleApps.developer.revenueType.', entry.type].join('') as any, entry.type)}
          </div>
        </div>
      ))}
      {!data.items.length ? (
        <div className={styles.empty}>{t('moduleApps.developer.noRevenue')}</div>
      ) : null}
    </div>
  );
});
RevenueList.displayName = 'RevenueList';

const PayoutList = memo<{ data: ModuleAppDeveloperPayoutListResult }>(({ data }) => {
  const { t } = useTranslation('common');
  return (
    <div className={styles.section}>
      <h3 className={styles.title}>{t('moduleApps.developer.payouts')}</h3>
      {data.items.map((payout) => (
        <div className={styles.row} key={payout.id}>
          <div className={styles.sectionHeader}>
            <span>{formatMoney(payout.totalAmount, payout.currency)}</span>
            <Status value={payout.status} />
          </div>
          <div className={styles.muted}>{payout.recipientMask ?? '-'}</div>
        </div>
      ))}
      {!data.items.length ? (
        <div className={styles.empty}>{t('moduleApps.developer.noPayouts')}</div>
      ) : null}
    </div>
  );
});
PayoutList.displayName = 'PayoutList';

const ApplicationsTab = memo<{
  canManage: boolean;
  onOpenSubmissions: () => void;
}>(({ canManage, onOpenSubmissions }) => {
  const [cursorStack, setCursorStack] = useState([0]);
  const cursor = cursorStack.at(-1) ?? 0;
  const resource = useSWR(['moduleApp.listMyDeveloperApps', cursor], () =>
    moduleAppService.listMyDeveloperApps({ cursor, limit: 20 }),
  );

  if (resource.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (resource.error) return <ResourceError onRetry={() => void resource.mutate()} />;

  return (
    <div className={styles.section}>
      <Applications
        apps={resource.data?.items ?? []}
        canManage={canManage}
        onChanged={resource.mutate}
        onCreate={onOpenSubmissions}
      />
      <PaginationControls
        canNext={resource.data?.nextCursor != null}
        canPrevious={cursorStack.length > 1}
        loading={resource.isLoading}
        onPrevious={() => setCursorStack((current) => current.slice(0, -1))}
        onNext={() =>
          setCursorStack((current) => [...current, resource.data?.nextCursor ?? cursor])
        }
      />
    </div>
  );
});
ApplicationsTab.displayName = 'ApplicationsTab';

const SubmissionsTab = memo<{ publisherVerified: boolean }>(({ publisherVerified }) => {
  const [cursorStack, setCursorStack] = useState([0]);
  const cursor = cursorStack.at(-1) ?? 0;
  const resource = useSWR(['moduleApp.listMyDeveloperSubmissions', cursor], () =>
    moduleAppService.listMyDeveloperSubmissions({ cursor, limit: 20 }),
  );

  if (resource.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (resource.error) return <ResourceError onRetry={() => void resource.mutate()} />;

  return (
    <div className={styles.section}>
      <Submissions
        items={resource.data?.items ?? []}
        publisherVerified={publisherVerified}
        onSubmitted={async () => void (await resource.mutate())}
      />
      <PaginationControls
        canNext={resource.data?.nextCursor != null}
        canPrevious={cursorStack.length > 1}
        loading={resource.isLoading}
        onPrevious={() => setCursorStack((current) => current.slice(0, -1))}
        onNext={() =>
          setCursorStack((current) => [...current, resource.data?.nextCursor ?? cursor])
        }
      />
    </div>
  );
});
SubmissionsTab.displayName = 'SubmissionsTab';

const FinanceTab = memo(() => {
  const [revenueCursorStack, setRevenueCursorStack] = useState([0]);
  const [payoutCursorStack, setPayoutCursorStack] = useState([0]);
  const revenueCursor = revenueCursorStack.at(-1) ?? 0;
  const payoutCursor = payoutCursorStack.at(-1) ?? 0;
  const summary = useSWR(['moduleApp.getMyDeveloperFinanceSummary'], () =>
    moduleAppService.getMyDeveloperFinanceSummary(),
  );
  const revenue = useSWR(['moduleApp.listMyDeveloperRevenue', revenueCursor], () =>
    moduleAppService.listMyDeveloperRevenue({ cursor: revenueCursor, limit: 20 }),
  );
  const payouts = useSWR(['moduleApp.listMyDeveloperPayouts', payoutCursor], () =>
    moduleAppService.listMyDeveloperPayouts({ cursor: payoutCursor, limit: 20 }),
  );

  return (
    <div className={styles.section}>
      {summary.isLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
      {summary.error ? <ResourceError onRetry={() => void summary.mutate()} /> : null}
      {summary.data ? <FinanceSummary data={summary.data} /> : null}

      {revenue.isLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {revenue.error ? <ResourceError onRetry={() => void revenue.mutate()} /> : null}
      {revenue.data ? (
        <>
          <RevenueList data={revenue.data} />
          <PaginationControls
            canNext={revenue.data.nextCursor != null}
            canPrevious={revenueCursorStack.length > 1}
            onPrevious={() => setRevenueCursorStack((current) => current.slice(0, -1))}
            onNext={() =>
              setRevenueCursorStack((current) => [
                ...current,
                revenue.data?.nextCursor ?? revenueCursor,
              ])
            }
          />
        </>
      ) : null}

      {payouts.isLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {payouts.error ? <ResourceError onRetry={() => void payouts.mutate()} /> : null}
      {payouts.data ? (
        <>
          <PayoutList data={payouts.data} />
          <PaginationControls
            canNext={payouts.data.nextCursor != null}
            canPrevious={payoutCursorStack.length > 1}
            onPrevious={() => setPayoutCursorStack((current) => current.slice(0, -1))}
            onNext={() =>
              setPayoutCursorStack((current) => [
                ...current,
                payouts.data?.nextCursor ?? payoutCursor,
              ])
            }
          />
        </>
      ) : null}
    </div>
  );
});
FinanceTab.displayName = 'FinanceTab';

type DeveloperTab = 'apps' | 'finance' | 'packages' | 'profile';
const resolveDeveloperTab = (value: null | string): DeveloperTab =>
  value === 'finance' || value === 'packages' || value === 'profile' ? value : 'apps';

const ModuleAppDeveloper = memo(() => {
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveDeveloperTab(searchParams.get('tab'));
  const profile = useSWR(['moduleApp.getMyPublisherProfile'], () =>
    moduleAppService.getMyPublisherProfile(),
  );
  const profileData = profile.data ?? null;

  const changeTab = (tab: DeveloperTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'apps') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  if (profile.isLoading) {
    return (
      <section className={styles.frame}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </section>
    );
  }
  if (profile.error) {
    return (
      <section className={styles.frame}>
        <Text type="danger">{t('moduleApps.developer.loadError')}</Text>
        <Button onClick={() => void profile.mutate()}>{t('moduleApps.developer.retry')}</Button>
      </section>
    );
  }

  return (
    <section className={styles.frame} data-testid="module-app-developer-console">
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.heading}>{t('moduleApps.developer.title')}</h2>
          {profileData ? <div className={styles.muted}>{profileData.displayName}</div> : null}
        </div>
        {profileData ? <Status value={profileData.status} /> : null}
      </header>
      {!profileData ? (
        <PublisherProfile profile={null} onSaved={profile.mutate} />
      ) : (
        <>
          {profileData.status !== 'verified' ? (
            <div className={styles.notice} role="status">
              {t(
                profileData.status === 'suspended'
                  ? 'moduleApps.developer.suspended'
                  : 'moduleApps.developer.pending',
              )}
            </div>
          ) : null}
          <Tabs
            activeKey={activeTab}
            items={[
              {
                children: (
                  <ApplicationsTab
                    canManage={profileData.status === 'verified'}
                    onOpenSubmissions={() => changeTab('packages')}
                  />
                ),
                key: 'apps',
                label: t('moduleApps.developer.apps'),
              },
              {
                children: <SubmissionsTab publisherVerified={profileData.status === 'verified'} />,
                key: 'packages',
                label: t('moduleApps.developer.packages'),
              },
              {
                children: <FinanceTab />,
                key: 'finance',
                label: t('moduleApps.developer.finance'),
              },
              {
                children: <PublisherProfile profile={profileData} onSaved={profile.mutate} />,
                key: 'profile',
                label: t('moduleApps.developer.profile'),
              },
            ]}
            onChange={(tab) => changeTab(resolveDeveloperTab(tab))}
          />
        </>
      )}
    </section>
  );
});

ModuleAppDeveloper.displayName = 'ModuleAppDeveloper';

export default ModuleAppDeveloper;
