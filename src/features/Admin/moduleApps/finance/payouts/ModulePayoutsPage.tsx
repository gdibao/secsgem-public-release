'use client';

import {
  ADMIN_CAPABILITIES,
  hasAdminCapability,
  type ModuleAppPayoutStatus,
} from '@lobechat/types';
import { Button, Input, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import CursorPager from '../../CursorPager';
import PayoutTable, { type ModuleAppPayoutRow } from '../../PayoutTable';
import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import ModulePageState from '../../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../../shared/queryState';
import PayoutActionModal from './PayoutActionModal';

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

type PayoutListResponse = { items: ModuleAppPayoutRow[]; nextCursor: null | string };
type PayoutModalMode = 'create' | 'manage';

const ModulePayoutsPage = memo<{ canWrite?: boolean }>(({ canWrite: canWriteOverride }) => {
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = canWriteOverride ?? hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const [modalMode, setModalMode] = useState<PayoutModalMode>();
  const [selectedPayout, setSelectedPayout] = useState<ModuleAppPayoutRow>();
  const status = searchParams.get('status') ?? undefined;
  const publisherId = searchParams.get('publisherId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const filters = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('cursor');
    next.delete('previousCursor');
    return next.toString();
  }, [searchParams]);
  const listKey = moduleAppCacheKeys.payouts(filters, cursor);
  const { data, error, isLoading } = useClientDataSWR<PayoutListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listPayouts({
        cursor,
        limit: 25,
        publisherId,
        status: status as ModuleAppPayoutStatus | undefined,
      }) as Promise<PayoutListResponse>,
  );
  const updateFilter = (name: string, value: string) =>
    setSearchParams((current) => setFilter(current, name, value || undefined));
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['status', 'publisherId', 'cursor', 'previousCursor'].forEach((key) => next.delete(key));
    setSearchParams(next);
  };
  const closeModal = () => {
    setModalMode(undefined);
    setSelectedPayout(undefined);
  };
  const mutationSucceeded = async () => {
    await mutate(listKey);
    closeModal();
  };
  const isFiltered = Boolean(status || publisherId || cursor);
  const statusValues = ['pending', 'eligible', 'processing', 'paid', 'failed', 'reversed'] as const;
  const statusLabels = {
    eligible: t('moduleApps.admin.finance.status.eligible'),
    failed: t('moduleApps.admin.finance.status.failed'),
    paid: t('moduleApps.admin.finance.status.paid'),
    pending: t('moduleApps.admin.finance.status.pending'),
    processing: t('moduleApps.admin.finance.status.processing'),
    reversed: t('moduleApps.admin.finance.status.reversed'),
  };
  const createAction = {
    icon: <Plus aria-hidden size={16} />,
    label: t('moduleApps.admin.payouts.create'),
    onClick: () => setModalMode('create' as const),
  };

  return (
    <section className={styles.page} data-testid="module-payouts-page">
      <header>
        <h1>{t('moduleApps.admin.payouts.title')}</h1>
        <p>{t('moduleApps.admin.payouts.description')}</p>
      </header>
      {canWrite && (data?.items.length ?? 0) > 0 ? (
        <div className={styles.controls}>
          <Button icon={createAction.icon} type="primary" onClick={createAction.onClick}>
            {createAction.label}
          </Button>
        </div>
      ) : null}
      <div className={styles.controls}>
        <label>
          {t('moduleApps.admin.payouts.filters.status')}
          <Select
            value={status ?? ''}
            options={[
              { label: t('moduleApps.admin.payouts.filters.all'), value: '' },
              ...statusValues.map((value) => ({ label: statusLabels[value], value })),
            ]}
            onChange={(value) => updateFilter('status', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.payouts.filters.publisherId')}
          <Input
            maxLength={36}
            value={publisherId ?? ''}
            onChange={(event) => updateFilter('publisherId', event.target.value)}
          />
        </label>
      </div>
      <ModulePageState
        emptyKind={isFiltered ? 'filtered' : 'initial'}
        error={error}
        isEmpty={!isLoading && !error && (data?.items.length ?? 0) === 0}
        loading={isLoading}
        loadingLabel={t('moduleApps.admin.payouts.loading')}
        primaryAction={!isFiltered && canWrite ? createAction : undefined}
        retryLabel={t('moduleApps.admin.payouts.retry')}
        emptyDescription={t(
          isFiltered
            ? 'moduleApps.admin.payouts.filteredEmptyDescription'
            : 'moduleApps.admin.payouts.emptyDescription',
        )}
        emptyTitle={t(
          isFiltered
            ? 'moduleApps.admin.payouts.filteredEmptyTitle'
            : 'moduleApps.admin.payouts.emptyTitle',
        )}
        onClearFilters={clearFilters}
        onRetry={() => mutate(listKey)}
      >
        <div>
          <PayoutTable
            canWrite={canWrite}
            items={data?.items ?? []}
            statusLabels={statusLabels}
            labels={{
              action: t('moduleApps.admin.payouts.columns.actions'),
              alipayTransaction: t('moduleApps.admin.payouts.columns.alipayTransaction'),
              amount: t('moduleApps.admin.payouts.columns.amount'),
              audit: t('moduleApps.admin.payouts.columns.audit'),
              manage: t('moduleApps.admin.payouts.manage'),
              payout: t('moduleApps.admin.payouts.columns.payout'),
              publisher: t('moduleApps.admin.payouts.columns.publisher'),
              recipient: t('moduleApps.admin.payouts.columns.recipient'),
              revenue: t('moduleApps.admin.payouts.columns.revenue'),
              status: t('moduleApps.admin.payouts.columns.status'),
            }}
            onAction={(row) => {
              setSelectedPayout(row);
              setModalMode('manage');
            }}
          />
          <CursorPager
            hasNext={Boolean(data?.nextCursor)}
            hasPrevious={Boolean(searchParams.getAll('previousCursor').length)}
            nextLabel={t('moduleApps.admin.payouts.next')}
            previousLabel={t('moduleApps.admin.payouts.previous')}
            onPrevious={() => setSearchParams(retreatCursor(searchParams))}
            onNext={() =>
              data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
            }
          />
        </div>
      </ModulePageState>
      {canWrite && modalMode ? (
        <PayoutActionModal
          open
          mode={modalMode}
          payout={selectedPayout}
          onClose={closeModal}
          onSuccess={mutationSucceeded}
        />
      ) : null}
    </section>
  );
});

ModulePayoutsPage.displayName = 'ModulePayoutsPage';

export default ModulePayoutsPage;
