'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, Input, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Plus, RefreshCw } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { MODULE_ADMIN_ROUTE_PATHS } from '../navigation/catalog';
import { moduleAppCacheKeys } from '../shared/cacheKeys';
import {
  clearModuleDraft,
  createModuleDraftScope,
  loadModuleDraft,
  saveModuleDraft,
} from '../shared/draftStorage';
import ModulePageState from '../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../shared/queryState';
import type { AdminModuleAppItem } from '../types';
import AppIdentityModal from './AppIdentityModal';
import { buildIdentityUpsertInput, type ModuleAppIdentityFormValues } from './identityForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  control: css`
    display: grid;
    flex: 1 1 180px;
    gap: 6px;

    min-width: min(180px, 100%);

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
  `,
  controlWide: css`
    flex-basis: 240px;
  `,
  description: css`
    max-width: 720px;
    margin-block: 4px 0;
    margin-inline: 0;

    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
  `,
  filterBar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;

    padding-block: 16px;
    border-block: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 16px 24px;
    align-items: center;
    justify-content: space-between;
  `,
  heading: css`
    min-width: 0;

    h1 {
      margin: 0;

      font-size: 24px;
      font-weight: 600;
      line-height: 32px;
      color: ${cssVar.colorText};
      overflow-wrap: anywhere;
    }
  `,
  page: css`
    display: grid;
    gap: 20px;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 1180px;

    @media (width < 640px) {
      gap: 16px;
    }
  `,
  pagination: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;

    padding-block-start: 12px;
  `,
  tableFrame: css`
    overflow-x: auto;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  tableLink: css`
    cursor: pointer;

    overflow: hidden;
    display: inline-flex;

    max-width: min(360px, 100%);
    padding: 0;
    border: 0;

    font: inherit;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;

    background: transparent;

    &:hover {
      color: ${cssVar.colorPrimary};
      text-decoration: underline;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  tableShell: css`
    min-width: 0;
  `,
  table: css`
    border-collapse: collapse;
    width: 100%;
    min-width: 640px;

    th,
    td {
      padding-block: 12px;
      padding-inline: 16px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      text-align: start;
    }

    th {
      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
    }

    td {
      line-height: 22px;
      color: ${cssVar.colorTextSecondary};
    }

    tbody tr:last-child td {
      border-block-end: 0;
    }

    tbody tr:hover td {
      background: ${cssVar.colorFillTertiary};
    }

    @media (width < 640px) {
      th,
      td {
        padding-inline: 12px;
      }
    }
  `,
}));

type ApplicationListResponse = { items: AdminModuleAppItem[]; nextCursor: null | string };
type ApplicationSort = 'catalog' | 'name_asc' | 'updated_desc';

const NEW_APP_IDENTITY_SCOPE = createModuleDraftScope('new', 'configuration');
const allowedSorts = new Set<ApplicationSort>(['catalog', 'name_asc', 'updated_desc']);

const ModuleAppsPage = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canReadPublishers = hasAdminCapability(role, ADMIN_CAPABILITIES.financeRead);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queryInput, setQueryInput] = useState(searchParams.get('q') ?? '');
  const [newIdentityDraft, setNewIdentityDraft] = useState<ModuleAppIdentityFormValues | null>(() =>
    loadModuleDraft<ModuleAppIdentityFormValues>(NEW_APP_IDENTITY_SCOPE),
  );

  const query = searchParams.get('q') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  const category = searchParams.get('category') ?? undefined;
  const publisherId = searchParams.get('publisherId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const sortValue = searchParams.get('sort');
  const sort = allowedSorts.has(sortValue as ApplicationSort)
    ? (sortValue as ApplicationSort)
    : undefined;
  const filters = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('cursor');
    params.delete('previousCursor');
    return params.toString();
  }, [searchParams]);
  const listKey = moduleAppCacheKeys.apps(filters, cursor);
  const { data, error, isLoading } = useClientDataSWR<ApplicationListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.list({
        category,
        cursor,
        limit: 25,
        publisherId,
        query,
        sort,
        status,
      }) as Promise<ApplicationListResponse>,
  );

  useEffect(() => setQueryInput(searchParams.get('q') ?? ''), [searchParams]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (queryInput.trim() === (searchParams.get('q') ?? '')) return;
      setSearchParams((current) => setFilter(current, 'q', queryInput.trim() || undefined));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [queryInput, searchParams, setSearchParams]);

  const updateFilter = (name: string, value: string) =>
    setSearchParams((current) => setFilter(current, name, value || undefined));
  const openApp = (appId: string) =>
    navigate(
      MODULE_ADMIN_ROUTE_PATHS['module-app-overview'].replace(':appId', encodeURIComponent(appId)),
    );
  const createApp = async (identity: ModuleAppIdentityFormValues) => {
    setSubmitting(true);
    try {
      const app = await adminCommercialService.moduleApps.upsert(
        buildIdentityUpsertInput(identity),
      );
      clearModuleDraft(NEW_APP_IDENTITY_SCOPE);
      setNewIdentityDraft(null);
      setIdentityOpen(false);
      await mutate(listKey);
      openApp(app.id);
    } finally {
      setSubmitting(false);
    }
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'status', 'category', 'publisherId', 'sort', 'cursor', 'previousCursor'].forEach((key) =>
      next.delete(key),
    );
    setSearchParams(next);
  };
  const isFiltered = Boolean(query || status || category || publisherId || sort || cursor);

  return (
    <section className={styles.page} data-testid="module-app-directory">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{t('moduleApps.admin.apps.title')}</h1>
          <p className={styles.description}>{t('moduleApps.admin.apps.description')}</p>
        </div>
        <div className={styles.actions}>
          <Button
            icon={RefreshCw}
            title={t('moduleApps.admin.apps.refresh')}
            onClick={() => mutate(listKey)}
          />
          <Button type="primary" onClick={() => setIdentityOpen(true)}>
            <Plus aria-hidden size={16} />
            {t('moduleApps.admin.apps.create')}
          </Button>
        </div>
      </header>
      <div className={styles.filterBar} data-testid="module-app-filters">
        <label className={styles.control} htmlFor="module-app-search">
          <span>{t('moduleApps.admin.apps.search')}</span>
          <Input
            id="module-app-search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
        </label>
        <label className={styles.control} htmlFor="module-app-status">
          <span>{t('moduleApps.admin.apps.status.label')}</span>
          <Select
            id="module-app-status"
            value={status ?? ''}
            options={[
              { label: t('moduleApps.admin.apps.filters.all'), value: '' },
              { label: t('moduleApps.admin.apps.status.draft'), value: 'draft' },
              { label: t('moduleApps.admin.apps.status.published'), value: 'published' },
              { label: t('moduleApps.admin.apps.status.unpublished'), value: 'unpublished' },
            ]}
            onChange={(value) => updateFilter('status', String(value ?? ''))}
          />
        </label>
        <label className={styles.control} htmlFor="module-app-category">
          <span>{t('moduleApps.admin.apps.category')}</span>
          <Input
            id="module-app-category"
            value={category ?? ''}
            onChange={(event) => updateFilter('category', event.target.value)}
          />
        </label>
        <label className={styles.control} htmlFor="module-app-sort">
          <span>{t('moduleApps.admin.apps.sort')}</span>
          <Select
            id="module-app-sort"
            value={sort ?? ''}
            options={[
              { label: t('moduleApps.admin.apps.sort.catalog'), value: '' },
              { label: t('moduleApps.admin.apps.sort.nameAsc'), value: 'name_asc' },
              { label: t('moduleApps.admin.apps.sort.updatedDesc'), value: 'updated_desc' },
            ]}
            onChange={(value) => updateFilter('sort', String(value ?? ''))}
          />
        </label>
        {canReadPublishers ? (
          <label
            className={`${styles.control} ${styles.controlWide}`}
            htmlFor="module-app-publisher"
          >
            <span>{t('moduleApps.admin.apps.publisher')}</span>
            <Input
              id="module-app-publisher"
              value={publisherId ?? ''}
              onChange={(event) => updateFilter('publisherId', event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <ModulePageState
        emptyKind={isFiltered ? 'filtered' : 'initial'}
        error={error}
        isEmpty={!isLoading && !error && (data?.items.length ?? 0) === 0}
        loading={isLoading}
        onClearFilters={clearFilters}
      >
        <div>
          <div className={styles.tableFrame} data-testid="module-app-table">
            <div className={styles.tableShell}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('moduleApps.admin.apps.identity.displayName')}</th>
                    <th>{t('moduleApps.admin.apps.category')}</th>
                    <th>{t('moduleApps.admin.apps.identity.status')}</th>
                    <th>{t('moduleApps.admin.apps.identity.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((app) => (
                    <tr key={app.id}>
                      <td>
                        <button
                          className={styles.tableLink}
                          type="button"
                          onClick={() => openApp(app.id)}
                        >
                          {app.displayName}
                        </button>
                      </td>
                      <td>{app.category}</td>
                      <td>{t(`moduleApps.admin.apps.status.${app.status}`)}</td>
                      <td>{t(`moduleApps.admin.apps.source.${app.source ?? 'admin'}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={styles.pagination}>
            <Button
              disabled={!searchParams.getAll('previousCursor').length}
              onClick={() => setSearchParams(retreatCursor(searchParams))}
            >
              {t('moduleApps.admin.apps.previous')}
            </Button>
            <Button
              disabled={!data?.nextCursor}
              onClick={() =>
                data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
              }
            >
              {t('moduleApps.admin.apps.next')}
            </Button>
          </div>
        </div>
      </ModulePageState>
      <AppIdentityModal
        draft={newIdentityDraft}
        open={identityOpen}
        submitting={submitting}
        onCancel={() => setIdentityOpen(false)}
        onSubmit={createApp}
        onDraftChange={(draft) => {
          setNewIdentityDraft(draft);
          saveModuleDraft(NEW_APP_IDENTITY_SCOPE, draft);
        }}
      />
    </section>
  );
});

ModuleAppsPage.displayName = 'ModuleAppsPage';

export default ModuleAppsPage;
