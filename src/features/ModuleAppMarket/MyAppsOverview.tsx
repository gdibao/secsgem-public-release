'use client';

import type {
  ModuleAppPackageSubmissionListResult,
  ModuleAppPackageSubmissionSummary,
} from '@lobechat/types';
import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button, Input } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { type InstalledModuleApp, moduleAppService } from '@/services/moduleApp';

import AppCard from './AppCard';
import ModuleAppPackageUploader from './PackageUploader';
import { useInstalledApps } from './useInstalledApps';

const SEARCH_DEBOUNCE_MS = 250;

const styles = createStaticStyles(({ css, cssVar }) => ({
  appGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 12px 16px;
  `,
  list: css`
    border-block: 1px solid ${cssVar.colorBorderSecondary};
  `,
  installedHeader: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 320px);
    gap: 12px;
    align-items: center;

    @media (width < 600px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  pagination: css`
    align-items: center;
    padding-block-start: 4px;
  `,
  row: css`
    padding-block: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  status: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  statusApproved: css`
    color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccessBg};
  `,
  statusRejected: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
}));

type ModuleAppMyAppsViewProps = {
  apps: InstalledModuleApp[];
  appsError?: unknown;
  hasMoreApps: boolean;
  loadingApps: boolean;
  loadingMoreApps: boolean;
  onLoadMoreApps: () => void;
  loadingSubmissions: boolean;
  onPackageSubmitted: () => Promise<void> | void;
  onRetryApps: () => Promise<unknown> | void;
  onSearchApps: (query: string) => void;
  searchQuery: string;
  submissions: ModuleAppPackageSubmissionSummary[];
  submissionsError?: unknown;
};

const statusLabelKeys = {
  approved: 'moduleApps.submissions.status.approved',
  pending_review: 'moduleApps.submissions.status.pendingReview',
  rejected: 'moduleApps.submissions.status.rejected',
} as const;

const statusClassNames = {
  approved: styles.statusApproved,
  pending_review: '',
  rejected: styles.statusRejected,
} as const;

const Loading = () => <Skeleton active paragraph={{ rows: 2 }} title={false} />;

export const ModuleAppMyAppsView = memo<ModuleAppMyAppsViewProps>(
  ({
    apps,
    appsError,
    hasMoreApps,
    loadingApps,
    loadingMoreApps,
    onLoadMoreApps,
    loadingSubmissions,
    onPackageSubmitted,
    onRetryApps,
    onSearchApps,
    searchQuery,
    submissions,
    submissionsError,
  }) => {
    const { t } = useTranslation('common');

    return (
      <Flexbox gap={28}>
        <Flexbox gap={12}>
          <div className={styles.installedHeader}>
            <Text as={'h3'} style={{ fontSize: 16, margin: 0 }} weight={600}>
              {t('moduleApps.installed.title')}
            </Text>
            <Input
              aria-label={t('moduleApps.installed.search')}
              maxLength={80}
              placeholder={t('moduleApps.installed.search')}
              type={'search'}
              value={searchQuery}
              onChange={(event) => onSearchApps(event.target.value)}
            />
          </div>
          {loadingApps ? (
            <Loading />
          ) : appsError && apps.length === 0 ? (
            <Flexbox align={'flex-start'} gap={8}>
              <Text role={'alert'} type={'danger'}>
                {t('moduleApps.installed.loadError')}
              </Text>
              <Button onClick={() => void onRetryApps()}>{t('moduleApps.installed.retry')}</Button>
            </Flexbox>
          ) : apps.length === 0 ? (
            <Text type={'secondary'}>
              {t(
                searchQuery.trim()
                  ? 'moduleApps.installed.emptySearch'
                  : 'moduleApps.installed.empty',
              )}
            </Text>
          ) : (
            <Flexbox gap={12}>
              <div className={styles.appGrid} data-testid={'module-app-installed-grid'}>
                {apps.map((app) => (
                  <AppCard
                    installed
                    category={app.category}
                    description={app.description}
                    id={app.id}
                    installationReadiness={app.installationReadiness}
                    key={app.id}
                    name={app.displayName}
                    publishedVersion={app.publishedVersion?.version}
                    updateAvailable={app.updateAvailable}
                    version={app.installedVersion?.version ?? app.version ?? undefined}
                  />
                ))}
              </div>
              {appsError ? (
                <Flexbox align={'center'} gap={8}>
                  <Text role={'alert'} type={'danger'}>
                    {t('moduleApps.installed.loadMoreError')}
                  </Text>
                  <Button onClick={() => void onRetryApps()}>
                    {t('moduleApps.installed.retry')}
                  </Button>
                </Flexbox>
              ) : hasMoreApps ? (
                <Flexbox className={styles.pagination}>
                  <Button loading={loadingMoreApps} onClick={onLoadMoreApps}>
                    {t('moduleApps.installed.loadMore')}
                  </Button>
                </Flexbox>
              ) : null}
            </Flexbox>
          )}
        </Flexbox>

        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Text as={'h3'} style={{ fontSize: 16, margin: 0 }} weight={600}>
              {t('moduleApps.submissions.title')}
            </Text>
            <ModuleAppPackageUploader onSubmitted={onPackageSubmitted} />
          </Flexbox>
          {loadingSubmissions ? (
            <Loading />
          ) : submissionsError ? (
            <Text role={'alert'} type={'danger'}>
              {t('moduleApps.submissions.loadError')}
            </Text>
          ) : submissions.length === 0 ? (
            <Text type={'secondary'}>{t('moduleApps.submissions.empty')}</Text>
          ) : (
            <Flexbox className={styles.list}>
              {submissions.map((submission) => (
                <Flexbox className={styles.row} gap={6} key={submission.id}>
                  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                    <Text weight={600}>{submission.appDisplayName}</Text>
                    <span
                      className={[styles.status, statusClassNames[submission.reviewStatus]]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {t(statusLabelKeys[submission.reviewStatus])}
                    </span>
                  </Flexbox>
                  <Text fontSize={12} type={'secondary'}>
                    {submission.fileName} · {submission.packageVersion}
                  </Text>
                  {submission.rejectionReason && (
                    <Text fontSize={12} type={'danger'}>
                      {submission.rejectionReason}
                    </Text>
                  )}
                </Flexbox>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);
ModuleAppMyAppsView.displayName = 'ModuleAppMyAppsView';

const MyAppsOverview = memo(() => {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const installedApps = useInstalledApps({ query: searchQuery, scope: 'personal' });
  const submissionsSWR = useSWR<ModuleAppPackageSubmissionListResult>(
    ['moduleApp.listMyPackageSubmissions'],
    () => moduleAppService.listMyPackageSubmissions({ limit: 20 }),
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  return (
    <ModuleAppMyAppsView
      apps={installedApps.items}
      appsError={installedApps.error}
      hasMoreApps={installedApps.hasMore}
      loadingApps={installedApps.isLoading}
      loadingMoreApps={installedApps.isLoadingMore}
      loadingSubmissions={submissionsSWR.isLoading}
      searchQuery={searchInput}
      submissions={submissionsSWR.data?.items ?? []}
      submissionsError={submissionsSWR.error}
      onLoadMoreApps={installedApps.loadMore}
      onRetryApps={installedApps.retry}
      onSearchApps={setSearchInput}
      onPackageSubmitted={async () => {
        await submissionsSWR.mutate();
      }}
    />
  );
});

MyAppsOverview.displayName = 'MyAppsOverview';

export default MyAppsOverview;
