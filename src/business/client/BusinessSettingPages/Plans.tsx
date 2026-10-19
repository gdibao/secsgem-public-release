'use client';

import { Plans as SubscriptionPlan, type SubscriptionCycleType } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Modal, Segmented } from '@lobehub/ui/base-ui';
import { Alert, Collapse, Empty, Input, message, Skeleton, Table, Tag, Tooltip } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import {
  BookOpen,
  Check,
  ChevronRight,
  Info,
  LockKeyhole,
  Mail,
  MessageCircle,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refreshCommercialEntitlementState } from '@/business/client/commercialRefresh';
import { Card } from '@/components/antd-compat/Card';
import { PUBLIC_PLAN_FAQ_SWR_KEY } from '@/const/adminCacheKeys';
import { DEFAULT_PLAN_FAQ_ITEMS } from '@/const/billingPresentation';
import {
  SubscriptionCheckoutModal,
  type SubscriptionCheckoutTarget,
} from '@/features/Payments/SubscriptionCheckoutModal';
import { readSubscriptionPaymentIntent } from '@/features/Payments/subscriptionIntent';
import PlanIcon from '@/features/PlanIcon';
import { useClientDataSWR } from '@/libs/swr';
import { commercialService } from '@/services/commercial';
import { useServerConfigStore } from '@/store/serverConfig';

import BusinessSettingsPageShell from './BusinessSettingsPageShell';
import { BusinessSettingsSection } from './mobile/BusinessMobileSection';
import { resolvePlanPurchaseAction } from './planPurchase';
import {
  getAvailableBillingCycles,
  getConfiguredVisiblePaidPlans,
  getDefaultMobilePlanTarget,
  getPlanYearlyDiscountLabel,
  getVisiblePaidPlans,
  getYearlyCycleDiscountLabel,
  resolvePlanCyclePrice,
} from './plansDisplay';
import {
  formatBusinessNumber,
  formatCredits,
  getSubscriptionCycleTranslationKey,
  subscriptionPageStyles,
  subscriptionPlanOrder,
  useBusinessSubscriptionProfile,
} from './shared';

type ModelRule = { allowlist?: string[]; blocklist?: string[]; mode?: string };

const MODEL_TYPE_LABELS: Record<string, string> = {
  chat: '对话模型',
  embedding: '向量模型',
  image: '图像模型',
  realtime: '实时模型',
  stt: '语音识别',
  text2music: '音乐模型',
  tts: '语音合成',
  video: '视频模型',
};

const PLAN_FEATURES_FALLBACK: Record<SubscriptionPlan, string[]> = {
  [SubscriptionPlan.Free]: ['500,000 算力积分', '10 MB 文件存储', '社区模型与插件市场'],
  [SubscriptionPlan.Hobby]: ['自定义 API 服务', '社区支持', '基础模型能力'],
  [SubscriptionPlan.Starter]: ['文件与知识库', '1 GB 文件存储', '邮件与社区支持'],
  [SubscriptionPlan.Premium]: ['文件与知识库', '2 GB 文件存储', '优先邮件支持'],
  [SubscriptionPlan.Ultimate]: ['高级模型服务', '4 GB 文件存储', '优先聊天与邮件支持'],
};

type BillingCycle = 'yearly' | 'monthly' | 'one_time' | 'lifetime';
type PlanCatalog = Awaited<ReturnType<typeof commercialService.listPlanCatalog>>;
type PlanCatalogItem = PlanCatalog[number];
type ComparisonRow = { feature: string; key: string } & Record<string, ReactNode>;
const LOADING_BILLING_CYCLES: BillingCycle[] = ['yearly', 'monthly'];

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    height: 38px;
    border-radius: 8px;
    font-weight: 600;
  `,
  actionGrid: css`
    display: grid;
    gap: 8px;
  `,
  benefit: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  benefitIcon: css`
    flex: none;
    margin-block-start: 2px;
    color: ${cssVar.colorSuccess};
  `,
  card: css`
    position: relative;

    overflow: hidden;

    height: 100%;
    min-height: 500px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    .ant-card-body {
      height: 100%;
      padding-block: 18px;
      padding-inline: 16px;
    }
  `,
  currentCard: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 1px ${cssVar.colorPrimaryBorder};
  `,
  cycleWrap: css`
    display: flex;
    justify-content: flex-end;
  `,
  featureGroup: css`
    display: flex;
    flex-direction: column;
    gap: 9px;

    padding-block-start: 18px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
  `,
  grid: css`
    scrollbar-width: thin;

    overflow-x: auto;
    display: flex;
    gap: 12px;

    padding-block-end: 4px;

    > .ant-card {
      flex: 0 0 min(320px, 86vw);
    }

    @media (width >= 1280px) {
      > .ant-card {
        flex-basis: calc((100% - 36px) / 4);
      }
    }
  `,
  header: css`
    min-height: 104px;
  `,
  introBar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-end;
    justify-content: space-between;

    padding-block: 2px 4px;
  `,
  introCopy: css`
    max-width: 520px;
  `,
  introSubtitle: css`
    margin-block-start: 4px;
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorTextDescription};
  `,
  introTitle: css`
    margin: 0;

    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  mobileCurrentPlan: css`
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  `,
  mobileCycleWrap: css`
    width: 100%;

    .ant-segmented,
    .ant-segmented-group {
      width: 100%;
    }

    .ant-segmented-item {
      flex: 1;
      min-width: 0;
    }

    .ant-segmented-item-label {
      display: flex;
      align-items: center;
      justify-content: center;

      min-height: 44px;
      padding-inline: 8px;
    }
  `,
  mobileGrid: css`
    scroll-padding-inline: 16px;
    scroll-snap-type: x mandatory;
    overscroll-behavior-inline: contain;

    > .ant-card {
      scroll-snap-align: start;
      flex-basis: min(320px, calc(100vw - 48px));
    }
  `,
  mobileTouchTarget: css`
    min-height: 44px;
  `,
  modelTag: css`
    max-width: 100%;
    margin: 0;
    border-radius: 999px;
  `,
  popularRibbon: css`
    position: absolute;
    inset-block-start: 16px;
    inset-inline-end: 16px;

    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
  price: css`
    display: flex;
    gap: 6px;
    align-items: baseline;

    margin-block: 10px 4px;

    font-size: 30px;
    font-weight: 700;
    line-height: 1;
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
  priceUnit: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextDescription};
  `,
  pricingCard: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    .ant-card-body {
      padding: 16px;
    }
  `,
  sectionTitle: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  selectableCard: css`
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  selectedCard: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
  `,
  subtitle: css`
    min-height: 40px;
    font-size: 13px;
    line-height: 1.55;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    margin: 0;

    font-size: 17px;
    font-weight: 700;
    line-height: 1.25;
    color: ${cssVar.colorText};
  `,
  top: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  `,
  wrapper: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: ${cssVar.colorText};
  `,
  supportActions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  yearlyLine: css`
    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 22px;

    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const getPlanKey = (plan: string): SubscriptionPlan | null =>
  subscriptionPlanOrder.includes(plan as SubscriptionPlan) ? (plan as SubscriptionPlan) : null;

const getCatalogPlan = (planCatalog: PlanCatalog | undefined, plan: SubscriptionPlan) =>
  planCatalog?.find((item) => item.plan === plan);

const isCatalogPlanAvailable = (
  planCatalog: PlanCatalog | undefined,
  plan: SubscriptionPlan,
  billingCycle: BillingCycle,
) => {
  const catalogPlan = getCatalogPlan(planCatalog, plan);

  return Boolean(catalogPlan && resolvePlanCyclePrice(catalogPlan, billingCycle).isAvailable);
};

const getRuleCount = (rule?: ModelRule) => {
  if (!rule) return 0;

  return rule.mode === 'blocklist' ? rule.blocklist?.length || 0 : rule.allowlist?.length || 0;
};

const getModelAccessSummary = (rules: Record<string, ModelRule>) => {
  const entries = Object.entries(rules).filter(([, rule]) => Boolean(rule));
  const allowlistEntries = entries.filter(([, rule]) => rule?.mode !== 'blocklist');
  const blocklistEntries = entries.filter(([, rule]) => rule?.mode === 'blocklist');

  if (entries.length === 0) {
    return {
      entries,
      label: '默认开放全部已启用模型',
    };
  }

  return {
    entries,
    label: [
      allowlistEntries.length > 0 ? `白名单 ${allowlistEntries.length} 类` : null,
      blocklistEntries.length > 0 ? `黑名单 ${blocklistEntries.length} 类` : null,
    ]
      .filter(Boolean)
      .join(' / '),
  };
};

const formatNullableQuota = (value: null | number | undefined, unit = '') => {
  if (value === null) return '不限';
  if (value === undefined) return '--';

  return `${formatBusinessNumber(value)}${unit}`;
};

const formatModelRulesSummary = (modelRules?: PlanCatalogItem['modelRules']) => {
  const rules = (modelRules || {}) as Record<string, ModelRule>;
  const entries = Object.entries(rules).filter(([, rule]) => Boolean(rule));

  if (entries.length === 0) return '默认可用模型';

  return entries
    .map(([type, rule]) => {
      const label = MODEL_TYPE_LABELS[type] || type;
      const mode = rule?.mode === 'blocklist' ? '排除' : '可用';

      return `${label}${mode} ${getRuleCount(rule)}`;
    })
    .join('；');
};

const findHelpMenuUrl = (
  items: Array<{ label: string; url?: string }> | undefined,
  matchers: string[],
  fallback?: string,
) => {
  const matched = items?.find((item) => {
    const label = item.label.toLowerCase();
    return matchers.some((matcher) => label.includes(matcher));
  });

  return matched?.url || fallback;
};

interface ResponsivePlanSectionProps {
  children: ReactNode;
  defaultOpen?: boolean;
  desktopClassName?: string;
  mobile?: boolean;
  title: ReactNode;
}

const ResponsivePlanSection = ({
  children,
  defaultOpen = true,
  desktopClassName,
  mobile,
  title,
}: ResponsivePlanSectionProps) => {
  if (mobile) {
    return (
      <BusinessSettingsSection mobile defaultOpen={defaultOpen} title={title}>
        {children}
      </BusinessSettingsSection>
    );
  }

  return desktopClassName ? (
    <Card className={desktopClassName} variant="borderless">
      {children}
    </Card>
  ) : (
    <>{children}</>
  );
};

const Plans = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('subscription');
  const { currentPlan, subscriptionSummary } = useBusinessSubscriptionProfile();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [mobileSelectedPlan, setMobileSelectedPlan] = useState<SubscriptionPlan>();
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<SubscriptionCheckoutTarget>();
  const [checkoutLoadingPlan, setCheckoutLoadingPlan] = useState<SubscriptionPlan>();
  const recoveredIntentKey = useRef<string | undefined>(undefined);
  const helpMenuItems = useServerConfigStore((s) => s.serverConfig.customization?.helpMenuItems);

  const {
    data: planCatalog,
    error: planCatalogError,
    isLoading: isPlanCatalogLoading,
    mutate: mutatePlanCatalog,
  } = useClientDataSWR(['business-plan-catalog'], () => commercialService.listPlanCatalog());
  const { data: pendingChangeRequest } = useClientDataSWR(
    ['business-subscription-change-request'],
    () => commercialService.getPendingSubscriptionChangeRequest(),
  );
  const {
    data: planFaqItems = DEFAULT_PLAN_FAQ_ITEMS,
    error: planFaqError,
    mutate: mutatePlanFaq,
  } = useClientDataSWR(PUBLIC_PLAN_FAQ_SWR_KEY, () => commercialService.listPlanFaq());
  const { data: subscriptionPaymentMethods, mutate: mutateSubscriptionPaymentMethods } =
    useClientDataSWR(['subscription-payment-methods'], () =>
      commercialService.getSubscriptionPaymentMethods(),
    );

  const visiblePlans = useMemo(() => {
    const configuredPlans = (planCatalog || [])
      .map((item) => getPlanKey(item.plan))
      .filter(Boolean) as SubscriptionPlan[];

    return getConfiguredVisiblePaidPlans(subscriptionPlanOrder, configuredPlans);
  }, [planCatalog]);

  const yearlyCycleDiscountLabel = useMemo(() => {
    return getYearlyCycleDiscountLabel(planCatalog);
  }, [planCatalog]);

  const availableBillingCycles = useMemo(
    () => (isPlanCatalogLoading ? LOADING_BILLING_CYCLES : getAvailableBillingCycles(planCatalog)),
    [isPlanCatalogLoading, planCatalog],
  );
  const hasAvailableBillingCycles = availableBillingCycles.length > 0;
  const activeBillingCycle = availableBillingCycles.includes(billingCycle)
    ? billingCycle
    : (availableBillingCycles[0] ?? 'monthly');

  useEffect(() => {
    if (!mobile) return;

    const isActionable = (plan: SubscriptionPlan) =>
      pendingChangeRequest?.toPlan !== plan &&
      isCatalogPlanAvailable(planCatalog, plan, activeBillingCycle);

    setMobileSelectedPlan((selectedPlan) => {
      if (selectedPlan && selectedPlan !== currentPlan && isActionable(selectedPlan)) {
        return selectedPlan;
      }

      return getDefaultMobilePlanTarget(visiblePlans, currentPlan, isActionable);
    });
  }, [
    activeBillingCycle,
    currentPlan,
    mobile,
    pendingChangeRequest?.toPlan,
    planCatalog,
    visiblePlans,
  ]);

  const mobileSelectedCatalogPlan =
    mobileSelectedPlan &&
    mobileSelectedPlan !== currentPlan &&
    pendingChangeRequest?.toPlan !== mobileSelectedPlan
      ? getCatalogPlan(planCatalog, mobileSelectedPlan)
      : undefined;
  const mobileSelectedPrice = mobileSelectedCatalogPlan
    ? resolvePlanCyclePrice(mobileSelectedCatalogPlan, activeBillingCycle)
    : undefined;

  useEffect(() => {
    const intent = readSubscriptionPaymentIntent();
    if (!intent || recoveredIntentKey.current === intent.idempotencyKey) return;

    recoveredIntentKey.current = intent.idempotencyKey;
    const catalogPlan = getCatalogPlan(planCatalog, intent.plan);
    const price = resolvePlanCyclePrice(catalogPlan, intent.cycle);
    setCheckoutTarget({
      cycle: intent.cycle,
      displayName: catalogPlan?.displayName || t(`plans.plan.${intent.plan}.title`),
      plan: intent.plan,
      priceLabel: price.isAvailable ? price.label : t('plans.payment.recovering', '恢复未完成支付'),
    });
  }, [planCatalog, t]);

  const comparisonColumns = useMemo(
    () => [
      {
        dataIndex: 'feature',
        fixed: 'left' as const,
        key: 'feature',
        title: '能力',
        width: 132,
      },
      ...visiblePlans.map((plan) => {
        const catalogPlan = getCatalogPlan(planCatalog, plan);

        return {
          dataIndex: plan,
          key: plan,
          render: (value: ReactNode) => value || '--',
          title: catalogPlan?.displayName || t(`plans.plan.${plan}.title`),
          width: 168,
        };
      }),
    ],
    [planCatalog, t, visiblePlans],
  );

  const comparisonRows = useMemo<ComparisonRow[]>(
    () =>
      [
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            catalogPlan?.comparisonNote || catalogPlan?.badge || '--',
          key: 'summary',
          title: '套餐亮点',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            formatCredits(catalogPlan?.monthlyCredits ?? subscriptionSummary?.monthlyCredits ?? 0),
          key: 'credits',
          title: '每月算力积分',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            formatNullableQuota(catalogPlan?.storageQuotaMb, ' MB'),
          key: 'storage',
          title: '文件存储',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            formatNullableQuota(catalogPlan?.vectorQuota),
          key: 'vector',
          title: '向量记录',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) => {
            if (!catalogPlan?.pptEnabled) return '未启用';

            const quota =
              catalogPlan.pptMonthlyQuota === null
                ? '不限次数'
                : `${formatBusinessNumber(catalogPlan.pptMonthlyQuota ?? 0)} 次/月`;

            return `${quota} · ${formatBusinessNumber(catalogPlan.pptCreditCost)} 积分/次`;
          },
          key: 'ppt',
          title: 'PPT 创作',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            formatModelRulesSummary(catalogPlan?.modelRules),
          key: 'models',
          title: '模型权限',
        },
        {
          getValue: (catalogPlan?: PlanCatalogItem) =>
            getPlanYearlyDiscountLabel(catalogPlan) || '--',
          key: 'discount',
          title: '年付优惠',
        },
      ].map(({ getValue, key, title }) => {
        const row: ComparisonRow = { feature: title, key };

        for (const plan of visiblePlans) {
          row[plan] = getValue(getCatalogPlan(planCatalog, plan));
        }

        return row;
      }),
    [planCatalog, subscriptionSummary?.monthlyCredits, visiblePlans],
  );

  const faqLinks = useMemo(
    () =>
      [
        {
          icon: BookOpen,
          label: '产品文档',
          url: findHelpMenuUrl(helpMenuItems, ['doc', '文档', '帮助']),
        },
        {
          icon: MessageCircle,
          label: '社区支持',
          url: findHelpMenuUrl(helpMenuItems, ['community', 'discord', '社区', '群']),
        },
        {
          icon: Mail,
          label: '邮件支持',
          url: findHelpMenuUrl(helpMenuItems, ['contact', 'support', '联系', '邮件']),
        },
      ].filter((item) => item.url),
    [helpMenuItems],
  );

  const getPlanFeatures = (plan: SubscriptionPlan) => {
    const catalogPlan = getCatalogPlan(planCatalog, plan);
    const configuredFeatures = catalogPlan?.features?.filter(Boolean);

    return configuredFeatures && configuredFeatures.length > 0
      ? configuredFeatures
      : PLAN_FEATURES_FALLBACK[plan];
  };

  const handleUpgradeClick = async (
    plan: SubscriptionPlan,
    catalogPlan: PlanCatalogItem | undefined,
    cycle: SubscriptionCycleType,
  ) => {
    setCheckoutLoadingPlan(plan);
    try {
      const methods = subscriptionPaymentMethods ?? (await mutateSubscriptionPaymentMethods());
      const action = resolvePlanPurchaseAction({
        hasOnlinePaymentMethods: Boolean(methods?.length),
        plan: catalogPlan,
      });

      if (action.type === 'checkout') {
        const price = resolvePlanCyclePrice(catalogPlan, cycle);
        setCheckoutTarget({
          cycle,
          displayName: catalogPlan?.displayName || t(`plans.plan.${plan}.title`),
          plan,
          priceLabel: price.label,
        });
        return;
      }
      if (action.type === 'external') {
        window.open(action.url, '_blank', 'noopener,noreferrer');
        return;
      }

      message.info(t('billing.purchaseDisabledHint'));
    } catch {
      message.error(t('plans.payment.methodsFailed', '支付方式加载失败，请稍后重试'));
    } finally {
      setCheckoutLoadingPlan(undefined);
    }
  };

  const handleRedeem = async () => {
    const code = redeemCode.trim().toUpperCase();
    if (!code) {
      message.error('请输入兑换码');
      return;
    }

    setRedeeming(true);
    try {
      await commercialService.redeemCode(code);
      message.success('兑换成功，权益已发放');
      setRedeemCode('');
      setRedeemOpen(false);
      await refreshCommercialEntitlementState();
    } catch (error: any) {
      const msg = error?.message || '';
      const errorMap: Record<string, string> = {
        CODE_ALREADY_REDEEMED: '兑换码已被使用',
        CODE_DISABLED: '兑换码已停用',
        CODE_EXPIRED: '兑换码已过期',
        CODE_NOT_FOUND: '兑换码不存在',
        CODE_RACE: '兑换码已被使用',
      };
      const matched = Object.keys(errorMap).find((key) => msg.includes(key));
      message.error(matched ? errorMap[matched] : '兑换失败，请检查兑换码');
    } finally {
      setRedeeming(false);
    }
  };

  const mobileAction = mobile
    ? mobileSelectedCatalogPlan && mobileSelectedPrice?.isAvailable
      ? {
          label: t('mobile.plans.upgradeTo', {
            plan:
              mobileSelectedCatalogPlan.displayName ||
              t(`plans.plan.${mobileSelectedPlan ?? SubscriptionPlan.Free}.title`),
          }),
          onClick: () =>
            void handleUpgradeClick(
              mobileSelectedPlan!,
              mobileSelectedCatalogPlan,
              activeBillingCycle,
            ),
        }
      : {
          label: t('billing.redeem.title'),
          onClick: () => setRedeemOpen(true),
        }
    : undefined;

  return (
    <>
      <BusinessSettingsPageShell
        className={cx(subscriptionPageStyles.caption, styles.wrapper)}
        mobile={mobile}
        mobileAction={mobileAction}
        title="套餐"
      >
        <ResponsivePlanSection mobile={mobile} title={t('currentPlan.title')}>
          <div className={styles.introBar}>
            {mobile ? (
              <div className={styles.mobileCurrentPlan}>
                <PlanIcon plan={currentPlan} size={34} />
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <strong>{t(`plans.plan.${currentPlan}.title`)}</strong>
                </Flexbox>
              </div>
            ) : (
              <div className={styles.introCopy}>
                <h1 className={styles.introTitle}>升级方案</h1>
                <div className={styles.introSubtitle}>解锁更多容量与高级功能。</div>
              </div>
            )}
            <div className={cx(styles.cycleWrap, mobile && styles.mobileCycleWrap)}>
              {hasAvailableBillingCycles ? (
                <Segmented
                  value={activeBillingCycle}
                  variant="filled"
                  options={availableBillingCycles.map((cycle) => ({
                    label:
                      cycle === 'yearly' ? (
                        <Flexbox horizontal align="center" gap={8}>
                          按年
                          {yearlyCycleDiscountLabel && !mobile ? (
                            <Tag color="green" style={{ margin: 0 }}>
                              {yearlyCycleDiscountLabel}
                            </Tag>
                          ) : null}
                        </Flexbox>
                      ) : cycle === 'monthly' ? (
                        '按月'
                      ) : cycle === 'one_time' ? (
                        '一次性'
                      ) : (
                        '终身'
                      ),
                    value: cycle,
                  }))}
                  onChange={(value: string | number) => setBillingCycle(value as BillingCycle)}
                />
              ) : (
                <Alert
                  showIcon
                  description="后台尚未配置套餐价格，请联系管理员。"
                  message="暂无可购买周期"
                  type="warning"
                />
              )}
            </div>
          </div>
          {pendingChangeRequest ? (
            <Alert
              showIcon
              message="存在待处理的套餐变更"
              type="info"
              description={t('plans.pendingChangeDescription', {
                cycle: t(getSubscriptionCycleTranslationKey(pendingChangeRequest.cycle)),
                from: t(`plans.plan.${pendingChangeRequest.fromPlan}.title`),
                to: t(`plans.plan.${pendingChangeRequest.toPlan}.title`),
              })}
            />
          ) : null}
        </ResponsivePlanSection>
        <ResponsivePlanSection mobile={mobile} title={t('tab.plans')}>
          {mobile && planCatalogError ? (
            <Alert
              showIcon
              message={t('mobile.plans.catalogError')}
              type="error"
              action={
                <Button
                  className={styles.mobileTouchTarget}
                  onClick={() => void mutatePlanCatalog()}
                >
                  {t('mobile.error.retry')}
                </Button>
              }
            />
          ) : null}
          {isPlanCatalogLoading ? (
            <div className={cx(styles.grid, mobile && styles.mobileGrid)}>
              {(visiblePlans.length > 0 ? visiblePlans : getVisiblePaidPlans(subscriptionPlanOrder))
                .slice(0, 3)
                .map((plan) => (
                  <Card className={styles.card} key={plan}>
                    <Skeleton active paragraph={{ rows: 12 }} />
                  </Card>
                ))}
            </div>
          ) : visiblePlans.length === 0 ? (
            <Empty
              description={planCatalogError ? '套餐目录加载失败，请稍后重试。' : '暂无可用套餐'}
            />
          ) : (
            <div className={cx(styles.grid, mobile && styles.mobileGrid)}>
              {visiblePlans.map((plan) => {
                const catalogPlan = getCatalogPlan(planCatalog, plan);
                const price = catalogPlan
                  ? resolvePlanCyclePrice(catalogPlan, activeBillingCycle)
                  : {
                      amount: 0,
                      currency: '',
                      cycle: activeBillingCycle,
                      discountPercent: 0,
                      isAvailable: false,
                      label: '--',
                      secondaryLabel: undefined,
                      unit: t(getSubscriptionCycleTranslationKey(activeBillingCycle)),
                    };
                const monthlyCredits =
                  catalogPlan?.monthlyCredits ?? subscriptionSummary?.monthlyCredits ?? 0;
                const yearlyDiscountLabel = getPlanYearlyDiscountLabel(catalogPlan);
                const isCurrent = plan === currentPlan;
                const isPending = pendingChangeRequest?.toPlan === plan;
                const isSelected = Boolean(mobile && mobileSelectedPlan === plan);
                const canSelect = Boolean(mobile && !isCurrent && !isPending && price.isAvailable);
                const planBadge =
                  catalogPlan?.badge || (plan === SubscriptionPlan.Premium ? '最受欢迎' : '');
                const modelRules = (catalogPlan?.modelRules || {}) as Record<string, ModelRule>;
                const modelAccessSummary = getModelAccessSummary(modelRules);

                return (
                  <Card
                    aria-current={isSelected ? 'true' : undefined}
                    aria-disabled={mobile ? !canSelect : undefined}
                    key={plan}
                    role={mobile ? 'button' : undefined}
                    tabIndex={canSelect ? 0 : mobile ? -1 : undefined}
                    variant="borderless"
                    className={cx(
                      styles.card,
                      isCurrent && styles.currentCard,
                      canSelect && styles.selectableCard,
                      isSelected && styles.selectedCard,
                    )}
                    onClick={canSelect ? () => setMobileSelectedPlan(plan) : undefined}
                    onKeyDown={
                      canSelect
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setMobileSelectedPlan(plan);
                            }
                          }
                        : undefined
                    }
                  >
                    {planBadge ? <div className={styles.popularRibbon}>{planBadge}</div> : null}
                    <Flexbox gap={20} height="100%" justify="space-between">
                      <Flexbox gap={18}>
                        <Flexbox className={styles.header} gap={14}>
                          <div className={styles.top}>
                            <PlanIcon plan={plan} size={38} />
                            <Flexbox horizontal align="center" gap={6}>
                              {isCurrent ? <Tag color="blue">当前套餐</Tag> : null}
                              {isPending ? <Tag color="processing">待处理</Tag> : null}
                            </Flexbox>
                          </div>
                          <Flexbox gap={8}>
                            <h2 className={styles.title}>
                              {catalogPlan?.displayName || t(`plans.plan.${plan}.title`)}
                            </h2>
                            <div className={styles.subtitle}>{t(`plans.plan.${plan}.desc`)}</div>
                          </Flexbox>
                        </Flexbox>
                        <Flexbox gap={8}>
                          <div className={styles.price}>
                            <span>{price.label}</span>
                            <span className={styles.priceUnit}>/ {price.unit}</span>
                          </div>
                          <div className={styles.yearlyLine}>
                            {price.secondaryLabel ?? '--'}
                            {activeBillingCycle === 'yearly' &&
                            yearlyDiscountLabel &&
                            !price.secondaryLabel?.includes(yearlyDiscountLabel) ? (
                              <Tag color="green" style={{ margin: 0 }}>
                                {yearlyDiscountLabel}
                              </Tag>
                            ) : null}
                          </div>
                          {mobile ? null : isCurrent || isPending ? (
                            <Button
                              block
                              disabled
                              className={styles.action}
                              icon={<Icon icon={isCurrent ? Check : LockKeyhole} />}
                              type="default"
                            >
                              {isCurrent ? '当前套餐' : '待处理'}
                            </Button>
                          ) : (
                            <div className={styles.actionGrid}>
                              <Button
                                block
                                className={styles.action}
                                disabled={!price.isAvailable}
                                icon={<Icon icon={ChevronRight} />}
                                loading={checkoutLoadingPlan === plan}
                                type="primary"
                                onClick={() =>
                                  void handleUpgradeClick(plan, catalogPlan, activeBillingCycle)
                                }
                              >
                                {price.isAvailable ? '升级' : '暂未配置'}
                              </Button>
                              <Button
                                block
                                className={styles.action}
                                icon={<Icon icon={Ticket} />}
                                type="text"
                                onClick={() => setRedeemOpen(true)}
                              >
                                使用兑换码
                              </Button>
                            </div>
                          )}
                        </Flexbox>
                        <Flexbox className={styles.featureGroup} gap={10}>
                          <div className={styles.sectionTitle}>
                            <Icon icon={Sparkles} size={15} />
                            算力积分
                            <Tooltip title="不同模型的实际消息数会随上下文长度、输出长度和后台计费规则变化。">
                              <Icon icon={Info} size={14} />
                            </Tooltip>
                          </div>
                          <div className={styles.benefit}>
                            <Icon className={styles.benefitIcon} icon={Check} size={15} />
                            <span>{formatCredits(monthlyCredits)} / 每月</span>
                          </div>
                          <div className={styles.benefit}>
                            <Icon className={styles.benefitIcon} icon={Check} size={15} />
                            <span>实际可用模型和消耗以后台“模型与计费矩阵”为准</span>
                          </div>
                        </Flexbox>
                        <Flexbox className={styles.featureGroup} gap={10}>
                          <div className={styles.sectionTitle}>后台配置权益</div>
                          {getPlanFeatures(plan).map((feature) => (
                            <div className={styles.benefit} key={feature}>
                              <Icon className={styles.benefitIcon} icon={Check} size={15} />
                              <span>{feature.includes('.') ? t(feature as any) : feature}</span>
                            </div>
                          ))}
                        </Flexbox>
                        <Flexbox className={styles.featureGroup} gap={10}>
                          <div className={styles.sectionTitle}>文件与知识库</div>
                          <div className={styles.benefit}>
                            <Icon className={styles.benefitIcon} icon={Check} size={15} />
                            <span>
                              文件存储 {formatNullableQuota(catalogPlan?.storageQuotaMb, ' MB')}
                            </span>
                          </div>
                          <div className={styles.benefit}>
                            <Icon className={styles.benefitIcon} icon={Check} size={15} />
                            <span>
                              向量记录 {formatNullableQuota(catalogPlan?.vectorQuota, ' 条目')}
                            </span>
                          </div>
                        </Flexbox>
                        <Flexbox className={styles.featureGroup} gap={10}>
                          <div className={styles.sectionTitle}>
                            模型权限
                            <Tooltip title="这里汇总后台 API 设置中每个套餐的模型 allowlist/blocklist 规则。">
                              <Icon icon={Info} size={14} />
                            </Tooltip>
                          </div>
                          <div className={styles.benefit}>
                            <Icon className={styles.benefitIcon} icon={Check} size={15} />
                            <span>{modelAccessSummary.label}</span>
                          </div>
                          {modelAccessSummary.entries.length > 0 ? (
                            <Flexbox horizontal gap={6} wrap="wrap">
                              {modelAccessSummary.entries.map(([type, rule]) => (
                                <Tag className={styles.modelTag} key={type}>
                                  {MODEL_TYPE_LABELS[type] || type}
                                  {' / '}
                                  {rule?.mode === 'blocklist' ? '排除' : '可用'}{' '}
                                  {getRuleCount(rule)}
                                </Tag>
                              ))}
                            </Flexbox>
                          ) : null}
                        </Flexbox>
                      </Flexbox>
                    </Flexbox>
                  </Card>
                );
              })}
            </div>
          )}
        </ResponsivePlanSection>
        <ResponsivePlanSection
          defaultOpen={false}
          desktopClassName={styles.pricingCard}
          mobile={mobile}
          title="套餐对比"
        >
          <Flexbox gap={12}>
            <Flexbox gap={4}>
              {mobile ? null : <h2 className={styles.title}>套餐对比</h2>}
              <div className={subscriptionPageStyles.caption}>
                根据后台套餐配置汇总展示积分、资源额度、PPT
                权益、模型权限和优惠信息；分类维度对齐官方套餐页。
              </div>
            </Flexbox>
            <Table
              columns={comparisonColumns as any}
              dataSource={comparisonRows}
              locale={{ emptyText: <Empty description="暂无套餐对比数据" /> }}
              pagination={false}
              rowKey="key"
              scroll={{ x: Math.max(720, visiblePlans.length * 168 + 132) }}
              size="small"
            />
          </Flexbox>
        </ResponsivePlanSection>
        <ResponsivePlanSection
          defaultOpen={false}
          desktopClassName={styles.pricingCard}
          mobile={mobile}
          title="文本模型价格"
        >
          <Flexbox gap={12}>
            <Flexbox gap={4}>
              {mobile ? null : <h2 className={styles.title}>文本模型价格</h2>}
              <div className={subscriptionPageStyles.caption}>
                平台使用算力积分衡量 AI
                模型使用量。具体模型、倍率和可用套餐由后台“模型与计费矩阵”统一维护，新增 AI
                服务商或模型后会按后台配置生效。
              </div>
            </Flexbox>
            <Alert
              showIcon
              description="这里展示计费规则入口和解释，不写死任何官方模型价格；具体模型计费、服务商分组、默认模型和套餐开放范围以管理员后台配置为准。"
              message="模型价格随后台配置动态生效"
              type="info"
            />
          </Flexbox>
        </ResponsivePlanSection>
        <ResponsivePlanSection
          defaultOpen={false}
          desktopClassName={styles.pricingCard}
          mobile={mobile}
          title="常见问题"
        >
          <Flexbox gap={12}>
            <Flexbox gap={4}>
              {mobile ? null : <h2 className={styles.title}>常见问题</h2>}
              <div className={subscriptionPageStyles.caption}>
                如果您的问题未被解答，请通过后台配置的支持入口获取帮助。
              </div>
              {faqLinks.length > 0 ? (
                <div className={styles.supportActions}>
                  {faqLinks.map((item) => (
                    <Button
                      className={mobile ? styles.mobileTouchTarget : undefined}
                      href={item.url}
                      icon={<Icon icon={item.icon} />}
                      key={item.label}
                      rel="noopener noreferrer"
                      size={mobile ? 'middle' : 'small'}
                      target="_blank"
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </Flexbox>
            {mobile && planFaqError ? (
              <Alert
                showIcon
                message={t('mobile.plans.faqError')}
                type="error"
                action={
                  <Button className={styles.mobileTouchTarget} onClick={() => void mutatePlanFaq()}>
                    {t('mobile.error.retry')}
                  </Button>
                }
              />
            ) : null}
            <Collapse
              ghost
              items={planFaqItems.map((item) => ({
                children: item.answer,
                key: item.id,
                label: item.question,
              }))}
            />
          </Flexbox>
        </ResponsivePlanSection>
      </BusinessSettingsPageShell>
      <SubscriptionCheckoutModal
        target={checkoutTarget}
        onClose={() => setCheckoutTarget(undefined)}
      />
      <Modal
        confirmLoading={redeeming}
        okText="确认兑换"
        open={redeemOpen}
        title="兑换激活码"
        onOk={handleRedeem}
        onCancel={() => {
          setRedeemOpen(false);
          setRedeemCode('');
        }}
      >
        <Flexbox gap={10}>
          <div className={subscriptionPageStyles.caption}>
            输入后台发放的套餐、积分或充值兑换码，兑换成功后权益会自动到账。
          </div>
          <Input
            autoFocus
            placeholder="请输入激活码"
            value={redeemCode}
            onChange={(e: { target: { value: string } }) => setRedeemCode(e.target.value)}
            onPressEnter={() => void handleRedeem()}
          />
        </Flexbox>
      </Modal>
    </>
  );
});

Plans.displayName = 'Plans';
export default Plans;
