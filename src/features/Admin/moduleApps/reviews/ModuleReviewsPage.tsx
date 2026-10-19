'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, Input, Modal, Select, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { moduleAppCacheKeys } from '../shared/cacheKeys';
import ModulePageState from '../shared/ModulePageState';
import { advanceCursor, retreatCursor, setFilter } from '../shared/queryState';
import type { AdminModuleAppOutboundHostPurpose, AdminModuleAppPackageRow } from '../types';
import { getPackageColumns } from './packageColumns';

const styles = createStaticStyles(({ css, cssVar }) => ({
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  hostList: css`
    display: grid;
    gap: 12px;
  `,
  hostRow: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(160px, 220px);
    gap: 12px;
    align-items: center;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
  hostName: css`
    overflow-wrap: anywhere;
  `,
  page: css`
    display: grid;
    gap: 16px;
    max-width: 1180px;
  `,
  table: css`
    border-collapse: collapse;
    width: 100%;

    th,
    td {
      padding-block: 10px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      text-align: start;
    }
  `,
}));

type PackageListResponse = { items: AdminModuleAppPackageRow[]; nextCursor: null | string };
type ReviewAction = 'approve' | 'reject' | 'rescan';

const REVIEW_ACTION_TRANSLATION_KEYS = {
  approve: 'moduleApps.admin.reviews.approve',
  reject: 'moduleApps.admin.reviews.reject',
  rescan: 'moduleApps.admin.reviews.rescan',
} as const satisfies Record<ReviewAction, string>;

const getOutboundHosts = (target?: AdminModuleAppPackageRow) => {
  const hosts = target?.manifestSnapshot?.runtime?.outboundHosts;
  if (!Array.isArray(hosts)) return [];

  return [...new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean))];
};

const ModuleReviewsPage = memo(() => {
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite);
  const packageColumns = getPackageColumns((key) => t(key));
  const [action, setAction] = useState<ReviewAction>();
  const [actionError, setActionError] = useState<string>();
  const [actionTarget, setActionTarget] = useState<AdminModuleAppPackageRow>();
  const [actionComplete, setActionComplete] = useState(false);
  const [outboundHostPurposes, setOutboundHostPurposes] = useState<
    Record<string, AdminModuleAppOutboundHostPurpose | undefined>
  >({});
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const actionLabel = action ? t(REVIEW_ACTION_TRANSLATION_KEYS[action]) : '';
  const reviewStatus = searchParams.get('reviewStatus') ?? undefined;
  const buildStatus = searchParams.get('buildStatus') ?? undefined;
  const appId = searchParams.get('appId') ?? undefined;
  const publisherId = searchParams.get('publisherId') ?? undefined;
  const submittedByUserId = searchParams.get('submittedByUserId') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const filters = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('cursor');
    next.delete('previousCursor');
    return next.toString();
  }, [searchParams]);
  const listKey = moduleAppCacheKeys.packages(filters, cursor);
  const { data, error, isLoading } = useClientDataSWR<PackageListResponse>(
    listKey,
    () =>
      adminCommercialService.moduleApps.listPackages({
        appId,
        buildStatus: buildStatus as 'building' | 'failed' | 'queued' | 'ready' | undefined,
        cursor,
        limit: 25,
        publisherId,
        reviewStatus,
        submittedByUserId,
      }) as Promise<PackageListResponse>,
  );
  const updateFilter = (name: string, value: string) =>
    setSearchParams((current) => setFilter(current, name, value || undefined));
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    [
      'reviewStatus',
      'buildStatus',
      'appId',
      'publisherId',
      'submittedByUserId',
      'cursor',
      'previousCursor',
    ].forEach((key) => next.delete(key));
    setSearchParams(next);
  };
  const isFiltered = Boolean(
    reviewStatus || buildStatus || appId || publisherId || submittedByUserId || cursor,
  );
  const openAction = (nextAction: ReviewAction, target: AdminModuleAppPackageRow) => {
    setAction(nextAction);
    setActionComplete(false);
    setActionError(undefined);
    setActionTarget(target);
    setOutboundHostPurposes(
      Object.fromEntries(getOutboundHosts(target).map((host) => [host, undefined])),
    );
    setRejectReason('');
  };
  const closeAction = () => {
    if (submitting) return;
    setAction(undefined);
    setActionTarget(undefined);
  };
  const outboundHosts = getOutboundHosts(actionTarget);
  const outboundHostPolicies = outboundHosts.flatMap((host) => {
    const purpose = outboundHostPurposes[host];
    return purpose ? [{ host, purpose }] : [];
  });
  const approvalClassificationIncomplete =
    action === 'approve' && outboundHostPolicies.length !== outboundHosts.length;
  const submitAction = async () => {
    if (
      !action ||
      !actionTarget ||
      (action === 'reject' && !rejectReason.trim()) ||
      approvalClassificationIncomplete
    )
      return;
    setSubmitting(true);
    setActionError(undefined);
    try {
      if (action === 'approve') {
        const result = await adminCommercialService.moduleApps.approvePackage({
          outboundHostPolicies,
          packageId: actionTarget.id,
        });
        await mutate(listKey);
        await mutate(moduleAppCacheKeys.detail(result.appId));
        await mutate(
          (key) => Array.isArray(key) && key[0] === 'admin-module-apps' && key[1] === 'apps',
          undefined,
          { revalidate: true },
        );
      } else if (action === 'reject') {
        await adminCommercialService.moduleApps.rejectPackage({
          packageId: actionTarget.id,
          reason: rejectReason.trim(),
        });
        await mutate(listKey);
      } else {
        await adminCommercialService.moduleApps.rescanPackage({ packageId: actionTarget.id });
        await mutate(listKey);
      }
      setActionComplete(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('moduleApps.admin.reviews.actionError'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.page} data-testid="module-reviews-page">
      <header>
        <h1>{t('moduleApps.admin.reviews.title')}</h1>
        <p>{t('moduleApps.admin.reviews.description')}</p>
      </header>
      <div className={styles.controls}>
        <label>
          {t('moduleApps.admin.reviews.filters.reviewStatus')}
          <Select
            value={reviewStatus ?? ''}
            options={[
              { label: t('moduleApps.admin.reviews.filters.all'), value: '' },
              {
                label: t('moduleApps.admin.reviews.status.pendingReview'),
                value: 'pending_review',
              },
              { label: t('moduleApps.admin.reviews.status.approved'), value: 'approved' },
              { label: t('moduleApps.admin.reviews.status.rejected'), value: 'rejected' },
            ]}
            onChange={(value) => updateFilter('reviewStatus', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.reviews.filters.buildStatus')}
          <Select
            value={buildStatus ?? ''}
            options={[
              { label: t('moduleApps.admin.reviews.filters.all'), value: '' },
              { label: t('moduleApps.admin.reviews.buildStatus.queued'), value: 'queued' },
              { label: t('moduleApps.admin.reviews.buildStatus.building'), value: 'building' },
              { label: t('moduleApps.admin.reviews.buildStatus.ready'), value: 'ready' },
              { label: t('moduleApps.admin.reviews.buildStatus.failed'), value: 'failed' },
            ]}
            onChange={(value) => updateFilter('buildStatus', String(value ?? ''))}
          />
        </label>
        <label>
          {t('moduleApps.admin.reviews.filters.appId')}
          <Input
            maxLength={36}
            value={appId ?? ''}
            onChange={(event) => updateFilter('appId', event.target.value)}
          />
        </label>
        <label>
          {t('moduleApps.admin.reviews.filters.publisherId')}
          <Input
            maxLength={36}
            value={publisherId ?? ''}
            onChange={(event) => updateFilter('publisherId', event.target.value)}
          />
        </label>
        <label>
          {t('moduleApps.admin.reviews.filters.submittedByUserId')}
          <Input
            maxLength={255}
            value={submittedByUserId ?? ''}
            onChange={(event) => updateFilter('submittedByUserId', event.target.value)}
          />
        </label>
      </div>
      <ModulePageState
        emptyKind={isFiltered ? 'filtered' : 'initial'}
        error={error}
        isEmpty={!isLoading && !error && (data?.items.length ?? 0) === 0}
        loading={isLoading}
        loadingLabel={t('moduleApps.admin.reviews.loading')}
        retryLabel={t('moduleApps.admin.reviews.retry')}
        emptyDescription={t(
          isFiltered
            ? 'moduleApps.admin.reviews.filteredEmptyDescription'
            : 'moduleApps.admin.reviews.emptyDescription',
        )}
        emptyTitle={t(
          isFiltered
            ? 'moduleApps.admin.reviews.filteredEmptyTitle'
            : 'moduleApps.admin.reviews.emptyTitle',
        )}
        onClearFilters={clearFilters}
        onRetry={() => mutate(listKey)}
      >
        <div>
          <table className={styles.table}>
            <thead>
              <tr>
                {packageColumns.map((column) => (
                  <th key={column.title}>{t(column.title)}</th>
                ))}
                {canWrite ? <th>{t('moduleApps.admin.reviews.columns.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  {packageColumns.map((column) => (
                    <td key={column.title}>{column.render?.(item)}</td>
                  ))}
                  {canWrite ? (
                    <td>
                      <div className={styles.controls}>
                        <Button
                          disabled={
                            item.reviewStatus !== 'pending_review' || item.scanStatus !== 'clean'
                          }
                          onClick={() => openAction('approve', item)}
                        >
                          {t('moduleApps.admin.reviews.approve')}
                        </Button>
                        {item.reviewStatus === 'pending_review' && item.scanStatus !== 'clean' ? (
                          <Button onClick={() => openAction('rescan', item)}>
                            {t('moduleApps.admin.reviews.rescan')}
                          </Button>
                        ) : null}
                        <Button
                          disabled={item.reviewStatus !== 'pending_review'}
                          onClick={() => openAction('reject', item)}
                        >
                          {t('moduleApps.admin.reviews.reject')}
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.controls}>
            <Button
              disabled={!searchParams.getAll('previousCursor').length}
              onClick={() => setSearchParams(retreatCursor(searchParams))}
            >
              {t('moduleApps.admin.reviews.previous')}
            </Button>
            <Button
              disabled={!data?.nextCursor}
              onClick={() =>
                data?.nextCursor && setSearchParams(advanceCursor(searchParams, data.nextCursor))
              }
            >
              {t('moduleApps.admin.reviews.next')}
            </Button>
          </div>
        </div>
      </ModulePageState>
      {canWrite ? (
        <Modal
          destroyOnHidden
          cancelText={t('cancel')}
          confirmLoading={submitting}
          open={Boolean(action)}
          title={actionLabel}
          okButtonProps={{
            danger: action === 'reject',
            disabled:
              submitting ||
              (action === 'reject' && !rejectReason.trim()) ||
              approvalClassificationIncomplete,
          }}
          okText={
            action === 'reject' ? t('moduleApps.admin.reviews.confirmRejection') : actionLabel
          }
          onCancel={closeAction}
          onOk={actionComplete ? closeAction : submitAction}
        >
          {actionComplete ? <p>{t('moduleApps.admin.reviews.actionSuccess')}</p> : null}
          {action === 'approve' && !actionComplete && outboundHosts.length > 0 ? (
            <div className={styles.hostList}>
              {outboundHosts.map((host) => (
                <label className={styles.hostRow} key={host}>
                  <span className={styles.hostName}>{host}</span>
                  <Select
                    aria-label={host}
                    value={outboundHostPurposes[host] ?? ''}
                    options={[
                      {
                        label: t('moduleApps.admin.reviews.outboundPurpose.unclassified'),
                        value: '',
                      },
                      {
                        label: t('moduleApps.admin.reviews.outboundPurpose.general'),
                        value: 'general',
                      },
                      {
                        label: t('moduleApps.admin.reviews.outboundPurpose.ai'),
                        value: 'ai',
                      },
                      {
                        label: t('moduleApps.admin.reviews.outboundPurpose.payment'),
                        value: 'payment',
                      },
                    ]}
                    onChange={(value) =>
                      setOutboundHostPurposes((current) => ({
                        ...current,
                        [host]:
                          value === 'ai' || value === 'general' || value === 'payment'
                            ? value
                            : undefined,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}
          {action === 'reject' && !actionComplete ? (
            <label>
              {t('moduleApps.admin.reviews.rejectReason')}
              <TextArea
                required
                maxLength={1000}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </label>
          ) : null}
          {actionError ? <p role="alert">{actionError}</p> : null}
        </Modal>
      ) : null}
    </section>
  );
});

ModuleReviewsPage.displayName = 'ModuleReviewsPage';

export default ModuleReviewsPage;
