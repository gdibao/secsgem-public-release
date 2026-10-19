'use client';

import { Button } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import UsageTable from '@/features/Settings/stats/features/usage/UsageTable';
import { commercialService } from '@/services/commercial';

import BusinessSettingsPageShell from './BusinessSettingsPageShell';
import { BusinessSettingsSection } from './mobile/BusinessMobileSection';
import { subscriptionPageStyles, useBusinessSubscriptionProfile } from './shared';

const styles = createStaticStyles(({ css }) => ({
  overviewHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  quotaGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 24px;
    width: 100%;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
  quotaHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  quotaItem: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  `,
  quotaProgress: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;

    width: 100%;
  `,
}));

const formatAtomicCredits = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

const formatStorage = (bytes: number) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;

const formatQuotaValue = (
  used: number,
  quota: null | number | undefined,
  formatter: (value: number) => string,
) =>
  `${formatter(used)} / ${quota === null ? '不限' : quota === undefined ? '--' : formatter(quota)}`;

const getQuotaPercent = (used: number, quota: null | number | undefined) =>
  quota && quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

const Usage = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t: tSubscription } = useTranslation('subscription');
  const { accountSummary, currentPlan, subscriptionSummary } = useBusinessSubscriptionProfile();
  const accountBreakdown = accountSummary?.breakdown;

  const { data: resourceUsage } = useClientDataSWR(['business-resource-usage'], () =>
    commercialService.getResourceUsage(),
  );
  const subscriptionQuota = subscriptionSummary?.monthlyCredits ?? 0;
  const subscriptionUsed = Math.max(
    0,
    subscriptionQuota - (accountBreakdown?.subscription.available ?? 0),
  );
  const referralQuota = accountBreakdown?.referral.credited ?? 0;
  const referralUsed = accountBreakdown?.referral.consumed ?? 0;
  const storageUsed = resourceUsage?.storage.used ?? 0;
  const vectorUsed = resourceUsage?.vector.used ?? 0;

  const quotaCaption = (used: number, quota: null | number | undefined) => {
    const percent = getQuotaPercent(used, quota);

    return (
      <div className={styles.quotaProgress}>
        <Progress
          percent={percent}
          showInfo={false}
          size="small"
          status={quota !== null && quota !== undefined && used > quota ? 'exception' : 'normal'}
        />
        <span>{quota === null ? '不限额' : `${percent}%`}</span>
      </div>
    );
  };

  const detailsSection = (
    <BusinessSettingsSection mobile={mobile} title={'明细'}>
      <div className={subscriptionPageStyles.tableSection}>
        <UsageTable mobile={mobile} />
      </div>
    </BusinessSettingsSection>
  );

  const coreSection = (
    <BusinessSettingsSection
      mobile={mobile}
      title={'总览'}
      desktopExtra={
        mobile ? undefined : (
          <Button href="/settings/plans" size="small" type="primary">
            升级
          </Button>
        )
      }
    >
      <div className={styles.overviewHeader}>
        <strong>当前方案：{tSubscription(`plans.plan.${currentPlan}.title`)}</strong>
      </div>
      <div className={styles.quotaGrid}>
        {[
          {
            formatter: formatAtomicCredits,
            quota: subscriptionQuota,
            title: '积分',
            used: subscriptionUsed,
          },
          {
            formatter: formatAtomicCredits,
            quota: referralQuota,
            title: '返利积分',
            used: referralUsed,
          },
          {
            formatter: formatStorage,
            quota: resourceUsage?.storage.quota,
            title: '文件使用量',
            used: storageUsed,
          },
          {
            formatter: String,
            quota: resourceUsage?.vector.quota,
            title: '向量存储',
            used: vectorUsed,
          },
        ].map((item) => (
          <div className={styles.quotaItem} key={item.title}>
            <div className={styles.quotaHeader}>
              <span>{item.title}</span>
              <strong>{formatQuotaValue(item.used, item.quota, item.formatter)}</strong>
            </div>
            {quotaCaption(item.used, item.quota)}
          </div>
        ))}
      </div>
    </BusinessSettingsSection>
  );

  return (
    <BusinessSettingsPageShell
      mobile={mobile}
      title={'用量'}
      mobileAction={
        mobile ? { href: '/settings/plans', label: tSubscription('upgradePlan') } : undefined
      }
    >
      {coreSection}
      {detailsSection}
    </BusinessSettingsPageShell>
  );
});

Usage.displayName = 'Usage';
export default Usage;
