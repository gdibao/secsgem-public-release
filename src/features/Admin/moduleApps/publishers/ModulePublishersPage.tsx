'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, Input, Modal, Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import PublisherTable, { type ModuleAppPublisherRow } from '../PublisherTable';
import { moduleAppCacheKeys } from '../shared/cacheKeys';
import ModulePageState from '../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../shared/queryState';
import PublisherFormModal, { type PublisherFormValues } from './PublisherFormModal';

const styles = createStaticStyles(({ css }) => ({
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  page: css`
    display: grid;
    gap: 16px;
    max-width: 1180px;
  `,
}));

type PublisherListResponse = { items: ModuleAppPublisherRow[]; nextCursor: null | string };
type GovernanceAction = 'assign' | 'suspend' | 'verify';

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

const appListFamilyPredicate = (key: unknown) =>
  Array.isArray(key) && key[0] === 'admin-module-apps' && key[1] === 'apps';
const publisherListFamilyPredicate = (key: unknown) =>
  Array.isArray(key) && key[0] === 'admin-module-apps' && key[1] === 'publishers';
const invalidatePublisherLists = () =>
  mutate(publisherListFamilyPredicate, undefined, { revalidate: true });

const ModulePublishersPage = memo(() => {
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite);
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<GovernanceAction>();
  const [appId, setAppId] = useState('');
  const [error, setError] = useState<string>();
  const [selectedPublisher, setSelectedPublisher] = useState<ModuleAppPublisherRow>();
  const [submitting, setSubmitting] = useState(false);
  const status = searchParams.get('status') ?? undefined;
  const userId = searchParams.get('userId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const filters = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('cursor');
    next.delete('previousCursor');
    return next.toString();
  }, [searchParams]);
  const listKey = moduleAppCacheKeys.publishers(filters, cursor);
  const {
    data,
    error: loadError,
    isLoading,
  } = useClientDataSWR<PublisherListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listPublishers({
        cursor,
        limit: 25,
        status: status as 'pending' | 'suspended' | 'verified' | undefined,
        userId,
      }) as Promise<PublisherListResponse>,
  );
  const updateFilter = (name: string, value: string) =>
    setSearchParams((current) => setFilter(current, name, value || undefined));
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['status', 'userId', 'cursor', 'previousCursor'].forEach((key) => next.delete(key));
    setSearchParams(next);
  };
  const isFiltered = Boolean(status || userId || cursor);
  const createPublisher = async (values: PublisherFormValues) => {
    setSubmitting(true);
    try {
      await adminCommercialService.moduleApps.createPublisher(values);
      await invalidatePublisherLists();
      toast.success(t('moduleApps.admin.publishers.createSuccess'));
      setCreateOpen(false);
    } finally {
      setSubmitting(false);
    }
  };
  const openAction = (nextAction: GovernanceAction, publisher: ModuleAppPublisherRow) => {
    setAction(nextAction);
    setAppId('');
    setError(undefined);
    setSelectedPublisher(publisher);
  };
  const submitAction = async () => {
    const normalizedAppId = appId.trim();
    const appIdIsValid = UUID_PATTERN.test(normalizedAppId);
    if (!action || !selectedPublisher || (action === 'assign' && !appIdIsValid)) return;
    setSubmitting(true);
    setError(undefined);
    try {
      if (action === 'verify') {
        await adminCommercialService.moduleApps.verifyPublisher({
          publisherId: selectedPublisher.id,
          verificationMetadata: {},
        });
      } else if (action === 'suspend') {
        await adminCommercialService.moduleApps.suspendPublisher({
          publisherId: selectedPublisher.id,
        });
      } else {
        await adminCommercialService.moduleApps.assignPublisher({
          appId: normalizedAppId,
          publisherId: selectedPublisher.id,
        });
        await Promise.all([
          mutate(moduleAppCacheKeys.detail(normalizedAppId)),
          mutate(appListFamilyPredicate, undefined, { revalidate: true }),
        ]);
      }
      await invalidatePublisherLists();
      toast.success(t(`moduleApps.admin.publishers.${action}Success`));
      setAction(undefined);
      setSelectedPublisher(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('moduleApps.admin.publishers.actionError'),
      );
    } finally {
      setSubmitting(false);
    }
  };
  const appIdIsValid = UUID_PATTERN.test(appId.trim());

  return (
    <section className={styles.page} data-testid="module-publishers-page">
      <header>
        <h1>{t('moduleApps.admin.publishers.title')}</h1>
        <p>{t('moduleApps.admin.publishers.description')}</p>
      </header>
      <div className={styles.controls}>
        <label>
          {t('moduleApps.admin.publishers.filters.status')}
          <Select
            value={status ?? ''}
            options={[
              { label: t('moduleApps.admin.publishers.filters.all'), value: '' },
              { label: t('moduleApps.admin.publishers.status.pending'), value: 'pending' },
              { label: t('moduleApps.admin.publishers.status.verified'), value: 'verified' },
              { label: t('moduleApps.admin.publishers.status.suspended'), value: 'suspended' },
            ]}
            onChange={(value) => updateFilter('status', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.publishers.filters.userId')}
          <Input
            maxLength={255}
            value={userId ?? ''}
            onChange={(event) => updateFilter('userId', event.target.value)}
          />
        </label>
        {canWrite && (data?.items.length ?? 0) > 0 ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            {t('moduleApps.admin.publishers.create')}
          </Button>
        ) : null}
      </div>
      <ModulePageState
        emptyKind={isFiltered ? 'filtered' : 'initial'}
        error={loadError}
        isEmpty={!isLoading && !loadError && (data?.items.length ?? 0) === 0}
        loading={isLoading}
        loadingLabel={t('moduleApps.admin.publishers.loading')}
        retryLabel={t('moduleApps.admin.publishers.retry')}
        emptyDescription={t(
          isFiltered
            ? 'moduleApps.admin.publishers.filteredEmptyDescription'
            : 'moduleApps.admin.publishers.emptyDescription',
        )}
        emptyTitle={t(
          isFiltered
            ? 'moduleApps.admin.publishers.filteredEmptyTitle'
            : 'moduleApps.admin.publishers.emptyTitle',
        )}
        primaryAction={
          !isFiltered && canWrite
            ? {
                label: t('moduleApps.admin.publishers.create'),
                onClick: () => setCreateOpen(true),
              }
            : undefined
        }
        onClearFilters={clearFilters}
        onRetry={() => mutate(listKey)}
      >
        <PublisherTable
          showPager
          actionsTitle={t('moduleApps.admin.publishers.actions')}
          hasNext={Boolean(data?.nextCursor)}
          hasPrevious={Boolean(searchParams.getAll('previousCursor').length)}
          items={data?.items ?? []}
          labels={{
            columns: {
              apps: t('moduleApps.admin.publishers.columns.apps'),
              id: t('moduleApps.admin.publishers.columns.id'),
              owner: t('moduleApps.admin.publishers.columns.owner'),
              publisher: t('moduleApps.admin.publishers.columns.publisher'),
              recipient: t('moduleApps.admin.publishers.columns.recipient'),
              status: t('moduleApps.admin.publishers.columns.status'),
            },
            empty: t('moduleApps.admin.publishers.emptyTitle'),
            loading: t('moduleApps.admin.publishers.loading'),
            next: t('moduleApps.admin.publishers.next'),
            previous: t('moduleApps.admin.publishers.previous'),
            retry: t('moduleApps.admin.publishers.retry'),
            status: {
              pending: t('moduleApps.admin.publishers.status.pending'),
              suspended: t('moduleApps.admin.publishers.status.suspended'),
              verified: t('moduleApps.admin.publishers.status.verified'),
            },
          }}
          renderActions={
            canWrite
              ? (publisher) => (
                  <div className={styles.controls}>
                    <Button onClick={() => openAction('verify', publisher)}>
                      {t('moduleApps.admin.publishers.verify')}
                    </Button>
                    <Button onClick={() => openAction('suspend', publisher)}>
                      {t('moduleApps.admin.publishers.suspend')}
                    </Button>
                    <Button onClick={() => openAction('assign', publisher)}>
                      {t('moduleApps.admin.publishers.assign')}
                    </Button>
                  </div>
                )
              : undefined
          }
          onPrevious={() => setSearchParams(retreatCursor(searchParams))}
          onNext={() =>
            data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
          }
        />
      </ModulePageState>
      {canWrite ? (
        <PublisherFormModal
          open={createOpen}
          submitting={submitting}
          onCancel={() => setCreateOpen(false)}
          onSubmit={createPublisher}
        />
      ) : null}
      {canWrite ? (
        <Modal
          destroyOnHidden
          cancelText={t('cancel')}
          confirmLoading={submitting}
          okButtonProps={{ disabled: submitting || (action === 'assign' && !appIdIsValid) }}
          okText={action ? t(`moduleApps.admin.publishers.${action}`) : ''}
          open={Boolean(action)}
          title={action ? t(`moduleApps.admin.publishers.${action}`) : ''}
          onCancel={() => !submitting && setAction(undefined)}
          onOk={submitAction}
        >
          {action === 'assign' ? (
            <label>
              {t('moduleApps.admin.publishers.appId')}
              <Input
                maxLength={36}
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
              />
            </label>
          ) : null}
          {action === 'assign' && appId && !appIdIsValid ? (
            <p role="alert">{t('moduleApps.admin.publishers.appIdError')}</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </Modal>
      ) : null}
    </section>
  );
});

ModulePublishersPage.displayName = 'ModulePublishersPage';

export default ModulePublishersPage;
