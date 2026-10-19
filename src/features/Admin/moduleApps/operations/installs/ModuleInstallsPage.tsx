'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import CursorPager from '../../CursorPager';
import InstallsTable from '../../InstallsTable';
import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import ModulePageState from '../../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../../shared/queryState';
import type { ModuleAppInstallRow } from '../../types';
import ModuleAppFilter from '../ModuleAppFilter';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    display: grid;
    gap: 16px;
    max-width: 1180px;
  `,
}));

type ListResponse = { items?: ModuleAppInstallRow[]; nextCursor?: null | string };

const ModuleInstallsPage = memo(() => {
  const { t: translate } = useTranslation('common');
  const t = (key: string) => translate(key as any);
  const [searchParams, setSearchParams] = useSearchParams();
  const appId = searchParams.get('appId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const listKey = appId ? moduleAppCacheKeys.installs(appId, cursor) : null;
  const { data, error, isLoading } = useClientDataSWR<ListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listInstalls({
        appId: appId!,
        cursor,
        limit: 25,
      }) as Promise<ListResponse>,
  );

  return (
    <section className={styles.page} data-testid="module-installs-page">
      <header>
        <h1>{t('moduleApps.admin.operations.installs.title')}</h1>
        <p>{t('moduleApps.admin.operations.installs.description')}</p>
      </header>
      <ModuleAppFilter />
      {!appId ? (
        <p data-testid="module-operation-app-required">
          {t('moduleApps.admin.operations.selectAppDescription')}
        </p>
      ) : (
        <ModulePageState
          emptyKind={cursor ? 'filtered' : 'initial'}
          error={error}
          isEmpty={!isLoading && !error && (data?.items?.length ?? 0) === 0}
          loading={isLoading}
          loadingLabel={t('moduleApps.admin.operations.loading')}
          retryLabel={t('moduleApps.admin.operations.retry')}
          emptyDescription={t(
            cursor
              ? 'moduleApps.admin.operations.filteredEmptyDescription'
              : 'moduleApps.admin.operations.emptyDescription',
          )}
          emptyTitle={t(
            cursor
              ? 'moduleApps.admin.operations.filteredEmptyTitle'
              : 'moduleApps.admin.operations.emptyTitle',
          )}
          onRetry={() => listKey && mutate(listKey)}
          onClearFilters={() =>
            setSearchParams((current) => setFilter(current, 'cursor', undefined))
          }
        >
          <div>
            <InstallsTable
              items={data?.items}
              labels={{
                install: t('moduleApps.admin.operations.installs.columns.install'),
                installed: t('moduleApps.admin.operations.installs.columns.installed'),
                scope: t('moduleApps.admin.operations.installs.columns.scope'),
                status: t('moduleApps.admin.operations.installs.columns.status'),
                user: t('moduleApps.admin.operations.installs.columns.user'),
                workspace: t('moduleApps.admin.operations.installs.columns.workspace'),
              }}
            />
            <CursorPager
              hasNext={Boolean(data?.nextCursor)}
              hasPrevious={Boolean(searchParams.getAll('previousCursor').length)}
              nextLabel={t('moduleApps.admin.operations.next')}
              previousLabel={t('moduleApps.admin.operations.previous')}
              onPrevious={() => setSearchParams(retreatCursor(searchParams))}
              onNext={() =>
                data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
              }
            />
          </div>
        </ModulePageState>
      )}
    </section>
  );
});

ModuleInstallsPage.displayName = 'ModuleInstallsPage';

export default ModuleInstallsPage;
