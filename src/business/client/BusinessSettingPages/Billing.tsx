'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type TableColumnType } from 'antd';
import { Alert, Empty, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import PlanIcon from '@/features/PlanIcon';
import { useClientDataSWR } from '@/libs/swr';
import { commercialService } from '@/services/commercial';
import {
  type BillingOrderHistoryItem,
  type SubscriptionChangeRequestItem,
  type SubscriptionChangeRequestStatusType,
} from '@/types/business';

import BusinessSettingsPageShell from './BusinessSettingsPageShell';
import BusinessMobileRecordList from './mobile/BusinessMobileRecordList';
import { BusinessSettingsSection } from './mobile/BusinessMobileSection';
import {
  buildBillingChangeRecord,
  buildBillingOrderRecord,
  type BusinessRecordFormatters,
} from './mobile/businessRecordBuilders';
import {
  formatBusinessDate,
  formatCredits,
  formatCurrencyAmount,
  getBillingStatusTranslationKey,
  getSubscriptionCycleTranslationKey,
  subscriptionPageStyles,
  useBusinessSubscriptionProfile,
} from './shared';

const styles = createStaticStyles(({ css, cssVar }) => ({
  mobileSecondary: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block-start: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    overflow-wrap: anywhere;
  `,
  mobileSummaryGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 12px;

    > div {
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
  mobileTouchTarget: css`
    align-self: flex-start;
    min-height: 44px;
  `,
  planFeatures: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px 16px;
  `,
}));

const Billing = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('subscription');
  const { currentPlan, subscriptionSummary } = useBusinessSubscriptionProfile();
  const billingHistoryRef = useRef<HTMLDivElement>(null);
  const [billingHistoryOpen, setBillingHistoryOpen] = useState(false);
  const [planChangeHistoryOpen, setPlanChangeHistoryOpen] = useState(false);
  const { data: planCatalog = [], isLoading: isPlanCatalogLoading } = useClientDataSWR(
    ['business-plan-catalog'],
    () => commercialService.listPlanCatalog(),
  );
  const { data: pendingChangeRequest } = useClientDataSWR(
    ['business-subscription-change-request'],
    () => commercialService.getPendingSubscriptionChangeRequest(),
  );
  const {
    data: changeRequests = [],
    error: changeRequestsError,
    isLoading: isChangeRequestsLoading,
    mutate: refreshChangeRequests,
  } = useClientDataSWR(['business-subscription-change-history'], () =>
    commercialService.listSubscriptionChangeRequests({ limit: 20 }),
  );
  const {
    data: billingOrders = [],
    error: billingHistoryError,
    isLoading: isBillingHistoryLoading,
    mutate: refreshBillingHistory,
  } = useClientDataSWR(['commercial.listBillingOrders'], () =>
    commercialService.listBillingOrders({ limit: 20 }),
  );
  const currentCatalogPlan = planCatalog.find((item) => item.plan === currentPlan);
  const planFeatures = (currentCatalogPlan?.features || []).filter(Boolean);
  const hasBillingHistory = billingOrders.length > 0;
  const hasPlanChangeHistory = changeRequests.length > 0;
  const cycleLabel = t(getSubscriptionCycleTranslationKey(subscriptionSummary?.cycle));
  const nextDate = subscriptionSummary?.renewsAt ?? subscriptionSummary?.endsAt;
  const billingStatusLabel = t(getBillingStatusTranslationKey(subscriptionSummary?.status));
  const recordFormatters = useMemo<
    Pick<BusinessRecordFormatters, 'formatCredits' | 'formatCurrency' | 'formatDate' | 't'>
  >(
    () => ({
      formatCredits,
      formatCurrency: (value, currency) => formatCurrencyAmount(value, currency ?? undefined),
      formatDate: formatBusinessDate,
      t: (key, options) => t(key as any, options as any),
    }),
    [t],
  );

  const handleViewBillingHistory = () => {
    if (mobile) setBillingHistoryOpen(true);
    billingHistoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const billingHistoryColumns = useMemo<TableColumnType<BillingOrderHistoryItem>[]>(
    () => [
      {
        dataIndex: 'id',
        ellipsis: true,
        key: 'id',
        render: (value: string, record) => record.externalOrderId || value,
        title: '订单号',
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: BillingOrderHistoryItem['status']) => (
          <Tag>{t('topup.status.' + value, value)}</Tag>
        ),
        title: '交易状态',
      },
      {
        dataIndex: 'amount',
        key: 'amount',
        render: (value, record) => formatCurrencyAmount(value, record.currency),
        title: '金额',
      },
      {
        dataIndex: 'paidAt',
        key: 'paidAt',
        render: (value) => formatBusinessDate(value),
        title: '付款日期',
      },
    ],
    [t],
  );

  const changeRequestColumns = useMemo<TableColumnType<SubscriptionChangeRequestItem>[]>(
    () => [
      {
        dataIndex: 'id',
        key: 'id',
        render: (value: string) => value.slice(0, 8),
        title: '变更编号',
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: SubscriptionChangeRequestStatusType) => t(`billing.changeStatus.${value}`),
        title: '变更状态',
      },
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (value) => formatBusinessDate(value),
        title: '提交时间',
      },
    ],
    [t],
  );

  const pendingChangeAlert = pendingChangeRequest ? (
    <Alert
      showIcon
      message={'存在待处理套餐变更'}
      type={'info'}
      description={`${t('plans.pendingChangeDescription', {
        cycle: t(getSubscriptionCycleTranslationKey(pendingChangeRequest.cycle)),
        from: t(`plans.plan.${pendingChangeRequest.fromPlan}.title`),
        to: t(`plans.plan.${pendingChangeRequest.toPlan}.title`),
      })} · ${formatBusinessDate(pendingChangeRequest.createdAt)}`}
    />
  ) : null;

  const mobileAction = mobile ? { href: '/settings/plans', label: t('upgradePlan') } : undefined;

  return (
    <BusinessSettingsPageShell mobile={mobile} mobileAction={mobileAction} title={'账单'}>
      <BusinessSettingsSection mobile={mobile} title={'账单摘要'}>
        {mobile ? (
          <Flexbox gap={16}>
            <div className={styles.mobileSummaryGrid}>
              <div>
                <div className={subscriptionPageStyles.caption}>
                  {t('billing.summary.currentCycleAmount')}
                </div>
                <div className={subscriptionPageStyles.tileValue}>
                  {formatCurrencyAmount(
                    subscriptionSummary?.currentCyclePrice ??
                      subscriptionSummary?.monthlyPrice ??
                      0,
                    subscriptionSummary?.currency,
                  )}
                </div>
              </div>
              <div>
                <div className={subscriptionPageStyles.caption}>{t('billing.summary.status')}</div>
                <strong>{billingStatusLabel}</strong>
              </div>
              <div>
                <div className={subscriptionPageStyles.caption}>{t('billing.summary.cycle')}</div>
                <strong>{cycleLabel}</strong>
              </div>
              <div>
                <div className={subscriptionPageStyles.caption}>
                  {t('billing.summary.renewsOrEndsAt')}
                </div>
                <strong>{formatBusinessDate(nextDate)}</strong>
              </div>
            </div>
            <div className={styles.mobileSecondary}>
              <div className={subscriptionPageStyles.caption}>
                {t('billing.summary.subscriptionId', {
                  id: subscriptionSummary?.externalSubscriptionId || '--',
                })}
              </div>
              <div className={subscriptionPageStyles.caption}>
                {t('billing.summary.startedAt', {
                  date: formatBusinessDate(subscriptionSummary?.startedAt),
                })}
              </div>
              <div className={subscriptionPageStyles.caption}>
                {t('billing.summary.amountDisclaimer')}
              </div>
              <Flexbox horizontal gap={8} wrap="wrap">
                <Button
                  className={styles.mobileTouchTarget}
                  type={'link'}
                  onClick={handleViewBillingHistory}
                >
                  账单历史
                </Button>
                <Button className={styles.mobileTouchTarget} href="/settings/usage" type={'link'}>
                  查看用量
                </Button>
              </Flexbox>
            </div>
            {pendingChangeAlert}
          </Flexbox>
        ) : (
          <>
            <div className={subscriptionPageStyles.cardGrid}>
              <div>
                <div>当前周期金额（{cycleLabel}）</div>
                <div className={subscriptionPageStyles.tileValue}>
                  {formatCurrencyAmount(
                    subscriptionSummary?.currentCyclePrice ??
                      subscriptionSummary?.monthlyPrice ??
                      0,
                    subscriptionSummary?.currency,
                  )}
                </div>
                <div className={subscriptionPageStyles.caption}>
                  此金额来自当前套餐快照，实际支付记录以账单历史为准。
                  <Button size={'small'} type={'link'} onClick={handleViewBillingHistory}>
                    查看账单历史
                  </Button>
                </div>
              </div>
              <div>
                <div>账单信息</div>
                <div className={subscriptionPageStyles.caption}>状态：{billingStatusLabel}</div>
                <div className={subscriptionPageStyles.caption}>
                  订阅 ID：{subscriptionSummary?.externalSubscriptionId || '--'}
                </div>
                <div className={subscriptionPageStyles.caption}>周期：{cycleLabel}</div>
                <div className={subscriptionPageStyles.caption}>
                  开始时间：{formatBusinessDate(subscriptionSummary?.startedAt)}
                </div>
                <div className={subscriptionPageStyles.caption}>
                  续费/结束时间：{formatBusinessDate(nextDate)}
                </div>
                <Button href="/settings/plans" size={'small'} type={'link'}>
                  升级计划
                </Button>
                <Button href="/settings/usage" size={'small'} type={'link'}>
                  查看用量
                </Button>
              </div>
            </div>
            {pendingChangeAlert}
          </>
        )}
      </BusinessSettingsSection>
      <BusinessSettingsSection mobile={mobile} title={'当前套餐'}>
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} justify={'space-between'} wrap={'wrap'}>
            <Flexbox gap={4}>
              <PlanIcon plan={currentPlan} type={'combine'} />
              <span className={subscriptionPageStyles.caption}>
                {currentCatalogPlan?.displayName || t(`plans.plan.${currentPlan}.title`)}
              </span>
            </Flexbox>
            {mobile ? null : (
              <Button href="/settings/plans" type={'primary'}>
                升级
              </Button>
            )}
          </Flexbox>
          {isPlanCatalogLoading ? (
            <div className={subscriptionPageStyles.caption}>正在加载套餐权益...</div>
          ) : planFeatures.length > 0 ? (
            <div className={styles.planFeatures}>
              {planFeatures.map((item) => (
                <div className={subscriptionPageStyles.caption} key={item}>
                  <Icon color={'#16a34a'} icon={Check} size={14} /> {item}
                </div>
              ))}
            </div>
          ) : (
            <div className={subscriptionPageStyles.caption}>后台暂未配置当前套餐权益。</div>
          )}
        </Flexbox>
      </BusinessSettingsSection>
      <div ref={billingHistoryRef}>
        <BusinessSettingsSection
          mobile={mobile}
          open={mobile ? billingHistoryOpen : undefined}
          title={'账单历史'}
          onOpenChange={mobile ? setBillingHistoryOpen : undefined}
        >
          {mobile ? (
            <BusinessMobileRecordList
              emptyDescription={'暂无账单记录'}
              error={billingHistoryError ? t('mobile.error.title') : undefined}
              isLoading={isBillingHistoryLoading}
              records={billingOrders.map((item) => buildBillingOrderRecord(item, recordFormatters))}
              sheetTitle={'账单详情'}
              onRetry={() => void refreshBillingHistory()}
            />
          ) : (
            <InlineTable
              columns={billingHistoryColumns as any}
              dataSource={billingOrders}
              loading={isBillingHistoryLoading}
              rowKey={(record) => record.id}
              locale={{
                emptyText: <Empty description={hasBillingHistory ? undefined : '暂无账单记录'} />,
              }}
            />
          )}
        </BusinessSettingsSection>
      </div>
      <div>
        <BusinessSettingsSection
          defaultOpen={false}
          mobile={mobile}
          open={mobile ? planChangeHistoryOpen : undefined}
          title={'套餐变更记录'}
          onOpenChange={mobile ? setPlanChangeHistoryOpen : undefined}
        >
          {mobile ? (
            <BusinessMobileRecordList
              emptyDescription={t('billing.changeHistory.empty')}
              error={changeRequestsError ? t('mobile.error.title') : undefined}
              isLoading={isChangeRequestsLoading}
              sheetTitle={t('billing.changeHistory.details')}
              records={changeRequests.map((item) =>
                buildBillingChangeRecord(item, recordFormatters),
              )}
              onRetry={() => void refreshChangeRequests()}
            />
          ) : (
            <InlineTable
              columns={changeRequestColumns as any}
              dataSource={changeRequests}
              loading={isChangeRequestsLoading}
              rowKey={(record) => record.id}
              locale={{
                emptyText: (
                  <Empty description={hasPlanChangeHistory ? undefined : '暂无套餐变更记录'} />
                ),
              }}
            />
          )}
        </BusinessSettingsSection>
      </div>
    </BusinessSettingsPageShell>
  );
});

Billing.displayName = 'Billing';
export default Billing;
