'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AuditEventsTable from '../AuditEventsTable';
import CursorPager from '../CursorPager';
import ModuleAppFilter from '../operations/ModuleAppFilter';
import { moduleAppCacheKeys } from '../shared/cacheKeys';
import ModulePageState from '../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../shared/queryState';
import type { ModuleAppAuditRow } from '../types';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    display: grid;
    gap: 16px;
    max-width: 1180px;
  `,
}));

type ListResponse = { items?: ModuleAppAuditRow[]; nextCursor?: null | string };

const ModuleAuditPage = memo(() => {
  const { t: translate } = useTranslation('common');
  const t = (key: string) => translate(key as any);
  const [searchParams, setSearchParams] = useSearchParams();
  const appId = searchParams.get('appId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const listKey = appId ? moduleAppCacheKeys.audit(appId, cursor) : null;
  const { data, error, isLoading } = useClientDataSWR<ListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listAuditEvents({
        appId: appId!,
        cursor,
        limit: 25,
      }) as Promise<ListResponse>,
  );

  return (
    <section className={styles.page} data-testid="module-audit-page">
      <header>
        <h1>{t('moduleApps.admin.audit.title')}</h1>
        <p>{t('moduleApps.admin.audit.description')}</p>
      </header>
      <ModuleAppFilter />
      {!appId ? (
        <p data-testid="module-audit-app-required">
          {t('moduleApps.admin.operations.selectAppDescription')}
        </p>
      ) : (
        <ModulePageState
          emptyKind={cursor ? 'filtered' : 'initial'}
          error={error}
          isEmpty={!isLoading && !error && (data?.items?.length ?? 0) === 0}
          loading={isLoading}
          loadingLabel={t('moduleApps.admin.audit.loading')}
          retryLabel={t('moduleApps.admin.audit.retry')}
          emptyDescription={t(
            cursor
              ? 'moduleApps.admin.audit.filteredEmptyDescription'
              : 'moduleApps.admin.audit.emptyDescription',
          )}
          emptyTitle={t(
            cursor
              ? 'moduleApps.admin.audit.filteredEmptyTitle'
              : 'moduleApps.admin.audit.emptyTitle',
          )}
          onRetry={() => listKey && mutate(listKey)}
          onClearFilters={() =>
            setSearchParams((current) => setFilter(current, 'cursor', undefined))
          }
        >
          <div>
            <AuditEventsTable
              items={data?.items}
              labels={{
                actor: t('moduleApps.admin.audit.columns.actor'),
                audit: t('moduleApps.admin.audit.columns.audit'),
                created: t('moduleApps.admin.audit.columns.created'),
                event: t('moduleApps.admin.audit.columns.event'),
              }}
            />
            <CursorPager
              hasNext={Boolean(data?.nextCursor)}
              hasPrevious={Boolean(searchParams.getAll('previousCursor').length)}
              nextLabel={t('moduleApps.admin.audit.next')}
              previousLabel={t('moduleApps.admin.audit.previous')}
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

ModuleAuditPage.displayName = 'ModuleAuditPage';

export default ModuleAuditPage;
