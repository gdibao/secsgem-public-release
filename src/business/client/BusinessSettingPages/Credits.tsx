'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type TableColumnType } from 'antd';
import { Empty, Tag } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';

import { refreshCommercialEntitlementState } from '@/business/client/commercialRefresh';
import InlineTable from '@/components/InlineTable';
import { useBrand } from '@/features/Brand/BrandProvider';
import PlanIcon from '@/features/PlanIcon';
import { TopUpPurchase } from '@/features/TopUp/TopUpPurchase';
import { commercialService } from '@/services/commercial';
import { type CreditLedgerEntryItem } from '@/types/business';

import AutoTopUpSettings from './AutoTopUpSettings';
import BusinessSettingsPageShell from './BusinessSettingsPageShell';
import CostEstimateAlert from './CostEstimateAlert';
import CreditPackageList from './CreditPackageList';
import { formatLedgerAllocationText, getNextCreditLedgerCursor } from './creditsDisplay';
import { formatCreditLedgerDescription } from './ledgerDisplay';
import BusinessMobileRecordList from './mobile/BusinessMobileRecordList';
import { BusinessSettingsSection } from './mobile/BusinessMobileSection';
import {
  buildCreditLedgerRecord,
  type BusinessRecordFormatters,
} from './mobile/businessRecordBuilders';
import RedemptionPanel from './RedemptionPanel';
import {
  formatBusinessDate,
  formatCredits,
  formatSignedCredits,
  getCreditLedgerTypeTranslationKey,
  getCreditSourceTranslationKey,
  isPaidPlan,
  subscriptionPageStyles,
  useBusinessSubscriptionProfile,
} from './shared';

const styles = createStaticStyles(({ css }) => ({
  balanceGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(220px, 0.8fr);
    gap: 12px;

    @media (width <= 768px) {
      grid-template-columns: 1fr;
    }
  `,
  balancePanel: css`
    display: flex;
    flex-direction: column;
    gap: 14px;
  `,
  balanceStats: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 560px) {
      grid-template-columns: 1fr;
    }
  `,
  bigValue: css`
    margin-block-start: 4px;

    font-size: 26px;
    font-weight: 700;
    line-height: 1.25;
    color: ${cssVar.colorText};
  `,
  mobileTouchTarget: css`
    min-height: 44px;
  `,
  subscriptionBox: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
}));

const Credits = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('subscription');
  const brand = useBrand();
  const { accountSummary, currentPlan, subscriptionSummary } = useBusinessSubscriptionProfile();
  const {
    data: ledgerPages,
    error: ledgerError,
    isLoading: isLedgerLoading,
    isValidating: isLedgerValidating,
    mutate: refreshLedger,
    setSize: setLedgerSize,
    size: ledgerPageCount,
  } = useSWRInfinite(
    (pageIndex, previousPage) => {
      if (previousPage && getNextCreditLedgerCursor(previousPage) === null) return null;
      return [
        'business-credit-ledger',
        pageIndex === 0 ? undefined : getNextCreditLedgerCursor(previousPage),
      ];
    },
    ([, cursor]) => commercialService.listCreditLedger({ cursor: cursor ?? undefined, limit: 20 }),
    { revalidateFirstPage: false },
  );
  const ledgerItems = useMemo(
    () => ledgerPages?.flatMap((page) => page.items) ?? [],
    [ledgerPages],
  );
  const hasMoreLedger = getNextCreditLedgerCursor(ledgerPages?.at(-1)) !== null;
  const accountBreakdown = accountSummary?.breakdown;

  const getLedgerAllocationText = useCallback(
    (record: CreditLedgerEntryItem) =>
      formatLedgerAllocationText(
        record,
        (source) => t(getCreditSourceTranslationKey(source)),
        formatCredits,
      ),
    [t],
  );

  const recordFormatters = useMemo<
    Pick<
      BusinessRecordFormatters,
      | 'creditLedgerAllocation'
      | 'creditLedgerDescription'
      | 'formatCredits'
      | 'formatDate'
      | 'formatSignedCredits'
      | 't'
    >
  >(
    () => ({
      creditLedgerAllocation: (item) => getLedgerAllocationText(item) ?? undefined,
      creditLedgerDescription: (item) =>
        formatCreditLedgerDescription(item.description, item.metadata),
      formatCredits,
      formatDate: formatBusinessDate,
      formatSignedCredits,
      t: (key, options) => t(key as any, options as any),
    }),
    [getLedgerAllocationText, t],
  );

  const ledgerColumns = useMemo<TableColumnType<CreditLedgerEntryItem>[]>(
    () => [
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (value) => formatBusinessDate(value),
        title: '创建时间',
      },
      {
        dataIndex: 'type',
        key: 'type',
        render: (value) => <Tag>{t(getCreditLedgerTypeTranslationKey(value))}</Tag>,
        title: '类型',
      },
      {
        dataIndex: 'title',
        key: 'title',
        render: (value, record) => value || record.referenceType || '--',
        title: '触发方式',
      },
      {
        dataIndex: 'amount',
        key: 'amount',
        render: (value) => formatSignedCredits(value),
        title: '消耗/增加积分',
      },
      {
        dataIndex: 'balanceAfter',
        key: 'balanceAfter',
        render: (value) => formatCredits(value),
        title: '余额',
      },
      {
        dataIndex: 'description',
        key: 'description',
        render: (value, record) => {
          const allocationText = getLedgerAllocationText(record);
          const description = formatCreditLedgerDescription(value, record.metadata);

          if (!allocationText) return description;

          return (
            <div>
              <div>{description}</div>
              <div className={subscriptionPageStyles.caption}>{allocationText}</div>
            </div>
          );
        },
        title: '说明',
      },
    ],
    [getLedgerAllocationText, t],
  );

  const refreshCreditData = () => {
    void refreshCommercialEntitlementState();
    void refreshLedger();
  };

  const mobileAction = mobile
    ? { href: '#credit-purchase', label: t('topup.online.title', '购买积分') }
    : undefined;

  return (
    <BusinessSettingsPageShell mobile={mobile} mobileAction={mobileAction} title={'积分'}>
      <BusinessSettingsSection mobile={mobile} title={'余额'}>
        <div className={styles.balanceGrid}>
          <div className={styles.balancePanel}>
            <div className={styles.balanceStats}>
              <div>
                <div className={subscriptionPageStyles.caption}>可用积分余额</div>
                <div className={styles.bigValue}>{formatCredits(accountSummary?.balance ?? 0)}</div>
              </div>
              <div>
                <div className={subscriptionPageStyles.caption}>订阅积分</div>
                <div className={styles.bigValue}>
                  {formatCredits(accountBreakdown?.subscription?.available ?? 0)} /{' '}
                  {formatCredits(subscriptionSummary?.monthlyCredits ?? 0)}
                </div>
              </div>
            </div>
            <div className={subscriptionPageStyles.caption}>
              优先使用订阅积分，其次使用充值积分。更新时间：
              {formatBusinessDate(accountSummary?.updatedAt)}
            </div>
            <Flexbox horizontal gap={8} wrap="wrap">
              <Button
                className={mobile ? styles.mobileTouchTarget : undefined}
                href="/settings/usage"
                size={mobile ? 'middle' : 'small'}
              >
                查看使用情况
              </Button>
              <Button
                className={mobile ? styles.mobileTouchTarget : undefined}
                href="/settings/billing"
                size={mobile ? 'middle' : 'small'}
              >
                充值记录
              </Button>
            </Flexbox>
          </div>
          <div className={styles.subscriptionBox}>
            <div className={subscriptionPageStyles.caption}>{brand.name} Subscription</div>
            <PlanIcon plan={currentPlan} type={'combine'} />
            <div className={subscriptionPageStyles.caption}>
              每月订阅积分 {formatCredits(subscriptionSummary?.monthlyCredits ?? 0)}
            </div>
          </div>
        </div>
      </BusinessSettingsSection>
      <div id="credit-purchase">
        <BusinessSettingsSection mobile={mobile} title={'购买积分'}>
          <TopUpPurchase />
        </BusinessSettingsSection>
      </div>
      <div id="credits-cost-estimate">
        <BusinessSettingsSection
          defaultOpen={false}
          mobile={mobile}
          title={t('credits.costEstimateHint.title')}
        >
          <CostEstimateAlert />
        </BusinessSettingsSection>
      </div>
      <div id="credits-auto-top-up">
        <BusinessSettingsSection
          defaultOpen={false}
          mobile={mobile}
          title={t('credits.autoTopUp.title')}
        >
          <AutoTopUpSettings isPaidPlan={isPaidPlan(currentPlan)} />
        </BusinessSettingsSection>
      </div>
      <div id="credit-packages">
        <BusinessSettingsSection mobile={mobile} title={'积分包'}>
          <CreditPackageList mobile={mobile} />
        </BusinessSettingsSection>
      </div>
      <div id="credit-redemption">
        <BusinessSettingsSection defaultOpen={false} mobile={mobile} title={'兑换码'}>
          <RedemptionPanel onSuccess={refreshCreditData} />
        </BusinessSettingsSection>
      </div>
      <div id="credit-ledger">
        <BusinessSettingsSection defaultOpen={false} mobile={mobile} title={'积分使用详情'}>
          {mobile ? (
            <Flexbox gap={8}>
              <BusinessMobileRecordList
                emptyDescription={t('credits.ledger.empty')}
                error={ledgerError ? t('mobile.error.title') : undefined}
                isLoading={isLedgerLoading}
                records={ledgerItems.map((item) => buildCreditLedgerRecord(item, recordFormatters))}
                sheetTitle={t('credits.ledger.details')}
                onRetry={() => void refreshLedger()}
              />
              {hasMoreLedger ? (
                <Button
                  loading={isLedgerValidating}
                  onClick={() => void setLedgerSize(ledgerPageCount + 1)}
                >
                  加载更多
                </Button>
              ) : null}
            </Flexbox>
          ) : (
            <InlineTable
              columns={ledgerColumns as any}
              dataSource={ledgerItems}
              loading={isLedgerLoading}
              locale={{ emptyText: <Empty description={'暂无积分明细'} /> }}
              rowKey={(record) => record.id}
            />
          )}
        </BusinessSettingsSection>
      </div>
    </BusinessSettingsPageShell>
  );
});

Credits.displayName = 'Credits';
export default Credits;
