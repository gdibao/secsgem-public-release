'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Spin, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ArrowRight,
  ChartNoAxesColumn,
  CircleDollarSign,
  GitPullRequest,
  Settings,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ADMIN_SETTINGS_SWR_KEY } from '@/const/adminCacheKeys';
import { ADMIN_BASE_PATH, ADMIN_NAV_GROUPS } from '@/features/Admin/adminNavigation';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { AdminMetricStrip, AdminPageError, AdminPageShell, AdminSection } from './layout';

const styles = createStaticStyles(({ css, cssVar }) => ({
  group: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    min-width: 0;
    padding-block: 14px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  groupDescription: css`
    margin: 0;
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
  `,
  groupGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 24px;

    @media (width < 960px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (width < 640px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  groupTitle: css`
    margin: 0;

    font-size: ${cssVar.fontSize};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
  keyValue: css`
    display: grid;
    grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr);
    gap: 12px;
    align-items: baseline;

    min-height: 32px;
    padding-block: 5px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  keyValueLabel: css`
    color: ${cssVar.colorTextSecondary};
  `,
  keyValueValue: css`
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    text-align: end;
    overflow-wrap: anywhere;
  `,
  link: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-height: 34px;
    padding-block: 5px;
    padding-inline: 8px;
    border: 0;
    border-radius: ${cssVar.borderRadiusSM};

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 1px;
    }
  `,
  linkList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  pending: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    justify-content: center;

    min-height: 88px;
  `,
  split: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;

    @media (width < 800px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
}));

const AdminOverviewPage = memo(() => {
  const navigate = useNavigate();
  const { t } = useTranslation('subscription');
  const {
    data: overview,
    error: overviewError,
    mutate: refreshOverview,
  } = useClientDataSWR(['admin-overview-stats'], () => adminCommercialService.getStatsOverview());
  const {
    data: pendingChanges,
    error: pendingChangesError,
    mutate: refreshPendingChanges,
  } = useClientDataSWR(['admin-overview-pending-changes'], () =>
    adminCommercialService.listChangeRequests({ limit: 1, status: 'pending' }),
  );
  const {
    data: settings,
    error: settingsError,
    mutate: refreshSettings,
  } = useClientDataSWR(ADMIN_SETTINGS_SWR_KEY, () => adminCommercialService.getAllSettings());

  const pendingChangeCount = pendingChanges?.total ?? 0;
  const defaultModel =
    settings?.defaultAgentProvider && settings?.defaultAgentModel
      ? `${settings.defaultAgentProvider}/${settings.defaultAgentModel}`
      : '未设置';

  return (
    <AdminPageShell
      description="集中查看关键状态，并进入用户、商业化、AI 平台、模块应用和系统运维。"
      title="后台工作台"
      width="full"
    >
      {overviewError ? (
        <AdminPageError description="核心指标加载失败，请重试。" onRetry={refreshOverview} />
      ) : (
        <AdminMetricStrip
          label={t('admin.overview.metricsLabel', '关键指标')}
          items={[
            {
              hint: '平台注册账户',
              icon: <Icon icon={Users} size={18} />,
              key: 'users',
              label: '总用户',
              value: overview ? overview.totalUsers : '...',
            },
            {
              hint: '最近 24 小时',
              icon: <Icon icon={UserRoundCheck} size={18} />,
              key: 'dau',
              label: '日活用户',
              value: overview ? overview.dau : '...',
            },
            {
              hint: '当前有效状态',
              icon: <Icon icon={ChartNoAxesColumn} size={18} />,
              key: 'subscriptions',
              label: '有效订阅',
              value: overview ? overview.activeSubscriptions : '...',
            },
            {
              hint: '近 30 天实收充值',
              icon: <Icon icon={CircleDollarSign} size={18} />,
              key: 'revenue',
              label: '充值收入',
              value: overview ? `$${overview.revenueLast30dUsd}` : '...',
            },
          ]}
        />
      )}

      <div className={styles.split}>
        <AdminSection
          description="优先处理会影响用户权益和订阅状态的请求。"
          title="待处理事项"
          actions={
            <Button size="small" onClick={() => navigate(`${ADMIN_BASE_PATH}/subscriptions`)}>
              处理请求
              <ArrowRight aria-hidden size={14} />
            </Button>
          }
        >
          <div className={styles.pending}>
            {pendingChangesError ? (
              <AdminPageError
                description="待处理事项加载失败，请重试。"
                onRetry={refreshPendingChanges}
              />
            ) : pendingChanges ? (
              <>
                <Tag
                  color={pendingChangeCount > 0 ? 'processing' : 'success'}
                  icon={<GitPullRequest size={13} />}
                >
                  套餐变更请求 {pendingChangeCount}
                </Tag>
                <Button size="small" onClick={() => navigate(`${ADMIN_BASE_PATH}/orders`)}>
                  查看相关订单
                </Button>
              </>
            ) : (
              <Spin />
            )}
          </div>
        </AdminSection>

        <AdminSection
          description="快速核对影响全站体验的核心默认值。"
          title="系统状态"
          actions={
            <Button size="small" onClick={() => navigate(`${ADMIN_BASE_PATH}/settings`)}>
              <Settings aria-hidden size={14} />
              修改设置
            </Button>
          }
        >
          {settingsError ? (
            <AdminPageError description="系统状态加载失败，请重试。" onRetry={refreshSettings} />
          ) : settings ? (
            <div>
              <div className={styles.keyValue}>
                <span className={styles.keyValueLabel}>品牌名称</span>
                <strong className={styles.keyValueValue}>{settings.brandName || '未设置'}</strong>
              </div>
              <div className={styles.keyValue}>
                <span className={styles.keyValueLabel}>默认模型</span>
                <strong className={styles.keyValueValue}>{defaultModel}</strong>
              </div>
              <div className={styles.keyValue}>
                <span className={styles.keyValueLabel}>推荐奖励</span>
                <strong className={styles.keyValueValue}>
                  {settings.referralRewardCredits ?? 0} 积分
                </strong>
              </div>
            </div>
          ) : (
            <Spin />
          )}
        </AdminSection>
      </div>

      <AdminSection
        description="入口按职责域组织；日常操作无需在长菜单中反复定位。"
        title="管理模块"
      >
        <div className={styles.groupGrid}>
          {ADMIN_NAV_GROUPS.filter((group) => group.key !== 'overview').map((group) => (
            <article className={styles.group} key={group.key}>
              <h3 className={styles.groupTitle}>{group.label}</h3>
              <p className={styles.groupDescription}>{group.description}</p>
              <div className={styles.linkList}>
                {group.items.map((item) => (
                  <button
                    className={styles.link}
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                  >
                    <span>{item.label}</span>
                    <ArrowRight aria-hidden size={14} />
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </AdminSection>
    </AdminPageShell>
  );
});

AdminOverviewPage.displayName = 'AdminOverviewPage';

export default AdminOverviewPage;
