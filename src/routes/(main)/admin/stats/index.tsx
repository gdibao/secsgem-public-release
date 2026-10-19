'use client';

import { Flexbox } from '@lobehub/ui';
import { Spin, Tag } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { BarChart, Sparkline, StackedBarChart } from '@/features/Admin';
import {
  AdminMetricStrip,
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
} from '@/features/Admin/layout';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

const PLAN_COLORS: Record<string, string> = {
  free: '#999',
  hobby: '#1677ff',
  premium: '#faad14',
  starter: '#13c2c2',
  ultimate: '#722ed1',
};

const AdminStatsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    mutate: refreshOverview,
  } = useClientDataSWR(['admin-stats'], () => adminCommercialService.getStatsOverview());
  const {
    data: dauTrend,
    error: dauTrendError,
    isLoading: dauTrendLoading,
    mutate: refreshDauTrend,
  } = useClientDataSWR(['admin-stats-dau-trend'], () => adminCommercialService.getStatsDauTrend());
  const {
    data: byPlan,
    error: byPlanError,
    isLoading: byPlanLoading,
    mutate: refreshByPlan,
  } = useClientDataSWR(['admin-stats-subs-by-plan'], () =>
    adminCommercialService.getStatsSubscriptionsByPlan(),
  );
  const {
    data: revenue,
    error: revenueError,
    isLoading: revenueLoading,
    mutate: refreshRevenue,
  } = useClientDataSWR(['admin-stats-revenue-month'], () =>
    adminCommercialService.getStatsRevenueByMonth(),
  );
  const {
    data: redemptionStats,
    error: redemptionError,
    isLoading: redemptionLoading,
    mutate: refreshRedemption,
  } = useClientDataSWR(['admin-stats-redemption'], () =>
    adminCommercialService.getStatsRedemptionOverview(),
  );

  const dauValues = useMemo(
    () => (dauTrend ?? []).map((d: { count: number }) => d.count),
    [dauTrend],
  );
  const planBars = useMemo(
    () =>
      (byPlan ?? []).map((d: { count: number; plan: string }) => ({
        label: d.plan,
        value: d.count,
      })),
    [byPlan],
  );
  const revenueStacked = useMemo(
    () =>
      (revenue ?? []).map((r) => ({
        label: r.month.slice(2),
        segments: [
          {
            color: '#1677ff',
            name: 'subscriptionSnapshotAmount',
            value: Number(r.subscriptionSnapshotAmount ?? r.subscription),
          },
          { color: '#faad14', name: 'topup', value: Number(r.topup) },
        ],
      })),
    [revenue],
  );

  return (
    <AdminPageShell
      description={t('admin.stats.description', '查看用户活跃度、订阅分布、收入与兑换码的运营趋势。')}
      title={t('admin.stats.title', '运营统计')}
      width="full"
    >
      <AdminSection title={t('admin.stats.overview', '核心指标')}>
        {overviewError ? (
          <AdminPageError
            description={t('admin.stats.overviewLoadFailed', '核心指标加载失败，请重试。')}
            onRetry={refreshOverview}
          />
        ) : overviewLoading ? (
          <Spin />
        ) : (
          <AdminMetricStrip
            label={t('admin.stats.overview', '核心指标')}
            items={[
              {
                key: 'users',
                label: t('admin.stats.totalUsers', '总用户'),
                value: overview?.totalUsers ?? 0,
              },
              {
                key: 'dau',
                label: t('admin.stats.dau', '日活用户'),
                value: overview?.dau ?? 0,
              },
              {
                key: 'mau',
                label: t('admin.stats.mau', '月活用户'),
                value: overview?.mau ?? 0,
              },
              {
                key: 'subscriptions',
                label: t('admin.stats.activeSubscriptions', '有效订阅'),
                value: overview?.activeSubscriptions ?? 0,
              },
              {
                key: 'revenue',
                label: t('admin.stats.revenue', '近 30 天实收充值收入'),
                value: `$${overview?.revenueLast30dUsd ?? 0}`,
              },
              {
                key: 'subscriptionSnapshot',
                label: t('admin.stats.subscriptionSnapshotAmount', '近 30 天订阅快照估算'),
                value: overview?.subscriptionSnapshotAmountLast30d ?? 0,
              },
            ]}
          />
        )}
      </AdminSection>

      <AdminSection title={t('admin.stats.dauTrend', '最近 30 天日活趋势')}>
        {dauTrendError ? (
          <AdminPageError
            description={t('admin.stats.dauLoadFailed', '日活趋势加载失败，请重试。')}
            onRetry={refreshDauTrend}
          />
        ) : dauTrendLoading ? (
          <Spin />
        ) : dauValues.length === 0 ? (
          <span>{t('admin.stats.noData', '暂无数据')}</span>
        ) : (
          <AdminResponsiveTable label={t('admin.stats.dauTrend', '最近 30 天日活趋势')}>
            <Sparkline data={dauValues} height={120} width={720} />
          </AdminResponsiveTable>
        )}
      </AdminSection>

      <AdminSection title={t('admin.stats.subsByPlan', '订阅按套餐分布')}>
        {byPlanError ? (
          <AdminPageError
            description={t('admin.stats.subscriptionsLoadFailed', '套餐分布加载失败，请重试。')}
            onRetry={refreshByPlan}
          />
        ) : byPlanLoading ? (
          <Spin />
        ) : planBars.length === 0 ? (
          <span>{t('admin.stats.noData', '暂无数据')}</span>
        ) : (
          <Flexbox gap={16}>
            <AdminResponsiveTable label={t('admin.stats.subsByPlan', '订阅按套餐分布')}>
              <BarChart data={planBars} height={200} width={720} />
            </AdminResponsiveTable>
            <Flexbox horizontal gap={12} wrap="wrap">
              {planBars.map((bar: { label: string; value: number }) => (
                <Flexbox horizontal align="center" gap={6} key={bar.label}>
                  <span
                    style={{
                      background: PLAN_COLORS[bar.label] ?? '#888',
                      borderRadius: 4,
                      display: 'inline-block',
                      height: 12,
                      width: 12,
                    }}
                  />
                  <span>
                    {bar.label}: <strong>{bar.value}</strong>
                  </span>
                </Flexbox>
              ))}
            </Flexbox>
          </Flexbox>
        )}
      </AdminSection>

      <AdminSection title={t('admin.stats.revenueByMonth', '最近 6 个月实收收入与订阅快照估算')}>
        {revenueError ? (
          <AdminPageError
            description={t('admin.stats.revenueLoadFailed', '收入趋势加载失败，请重试。')}
            onRetry={refreshRevenue}
          />
        ) : revenueLoading ? (
          <Spin />
        ) : revenueStacked.length === 0 ? (
          <span>{t('admin.stats.noData', '暂无数据')}</span>
        ) : (
          <Flexbox gap={16}>
            <AdminResponsiveTable label={t('admin.stats.revenueByMonth', '最近 6 个月收入趋势')}>
              <StackedBarChart data={revenueStacked} height={240} width={720} />
            </AdminResponsiveTable>
            <Flexbox horizontal gap={16} wrap="wrap">
              <Flexbox horizontal align="center" gap={6}>
                <span
                  style={{
                    background: '#1677ff',
                    borderRadius: 2,
                    display: 'inline-block',
                    height: 12,
                    width: 12,
                  }}
                />
                <span>{t('admin.stats.subscriptionSnapshot', '订阅快照估算')}</span>
              </Flexbox>
              <Flexbox horizontal align="center" gap={6}>
                <span
                  style={{
                    background: '#faad14',
                    borderRadius: 2,
                    display: 'inline-block',
                    height: 12,
                    width: 12,
                  }}
                />
                <span>{t('admin.stats.topup', '充值')}</span>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        )}
      </AdminSection>

      <AdminSection title={t('admin.stats.redemption.title', '兑换码')}>
        {redemptionError ? (
          <AdminPageError
            description={t('admin.stats.redemptionLoadFailed', '兑换码统计加载失败，请重试。')}
            onRetry={refreshRedemption}
          />
        ) : redemptionLoading ? (
          <Spin />
        ) : (
          <Flexbox gap={16}>
            <AdminMetricStrip
              label={t('admin.stats.redemption.title', '兑换码统计')}
              items={[
                {
                  key: 'active',
                  label: t('admin.stats.redemption.active', '可用'),
                  value: redemptionStats?.pending ?? 0,
                },
                {
                  key: 'redeemed',
                  label: t('admin.stats.redemption.redeemed', '已兑换'),
                  value: redemptionStats?.redeemed ?? 0,
                },
                {
                  key: 'disabled',
                  label: t('admin.stats.redemption.disabled', '已停用'),
                  value: redemptionStats?.disabled ?? 0,
                },
                {
                  key: 'expired',
                  label: t('admin.stats.redemption.expired', '已过期'),
                  value: redemptionStats?.expired ?? 0,
                },
                {
                  key: 'redeemed30d',
                  label: t('admin.stats.redemption.last30dRedeemed', '近 30 天兑换'),
                  value: redemptionStats?.redeemed30d ?? 0,
                },
                {
                  key: 'credits30d',
                  label: t('admin.stats.redemption.last30dCredits', '近 30 天发放积分'),
                  value: redemptionStats?.creditsGranted30d ?? 0,
                },
              ]}
            />
            {(redemptionStats?.byRewardType.length ?? 0) > 0 ? (
              <Flexbox horizontal gap={8} wrap="wrap">
                {redemptionStats?.byRewardType.map(
                  (reward: { rewardType: string; total: number }) => (
                  <Tag key={reward.rewardType}>
                    {reward.rewardType}: {reward.total}
                  </Tag>
                  ),
                )}
              </Flexbox>
            ) : null}
          </Flexbox>
        )}
      </AdminSection>
    </AdminPageShell>
  );
});

AdminStatsPage.displayName = 'AdminStatsPage';

export default AdminStatsPage;
