'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Select, Tabs } from '@lobehub/ui/base-ui';
import { Empty, Input, message, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatBusinessDate,
  formatCurrencyAmount,
} from '@/business/client/BusinessSettingPages/shared';
import InlineTable from '@/components/InlineTable';
import { formatAdminCredits } from '@/features/Admin/adminCreditUnits';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminChangeRequestsPage from './AdminChangeRequestsPage';
import type { AdminSubscriptionCycle } from './adminSubscriptionCycles';
import {
  ADMIN_SUBSCRIPTION_CYCLES,
  getAdminSubscriptionCycleLabel,
} from './adminSubscriptionCycles';
import { AdminPageShell, AdminResponsiveTable, AdminSection, AdminToolbar } from './layout';

type PlanFilter = 'all' | 'free' | 'hobby' | 'starter' | 'premium' | 'ultimate';

const PLAN_COLORS: Record<string, string> = {
  free: 'default',
  hobby: 'blue',
  premium: 'gold',
  starter: 'cyan',
  ultimate: 'purple',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'success',
  canceled: 'default',
  expired: 'warning',
  past_due: 'error',
  trialing: 'processing',
};

const styles = createStaticStyles(({ css }) => ({
  filter: css`
    width: 180px;

    @media (width < 640px) {
      width: 100%;
    }
  `,
}));

const AdminSubscriptionsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [plan, setPlan] = useState<PlanFilter>('all');
  const [cursorStack, setCursorStack] = useState<Array<number | undefined>>([undefined]);
  const cursor = cursorStack.at(-1);
  const [forceModal, setForceModal] = useState<{
    cycle: AdminSubscriptionCycle;
    plan: string;
    reason: string;
    userId: string;
    visible: boolean;
  }>({ cycle: 'monthly', plan: 'free', reason: '', userId: '', visible: false });
  const [submitting, setSubmitting] = useState(false);

  const swrKey = useMemo(() => ['admin-subscriptions', plan, cursor] as const, [plan, cursor]);

  const { data, isLoading, mutate } = useClientDataSWR(swrKey, () =>
    adminCommercialService.listSubscriptions({
      cursor,
      limit: 20,
      plan: plan === 'all' ? undefined : plan,
    }),
  );

  const items = data?.items ?? [];
  const nextCursor = data?.nextCursor;

  const handlePlanFilterChange = (value: PlanFilter) => {
    setPlan(value);
    setCursorStack([undefined]);
  };

  const handleNextPage = () => {
    if (nextCursor == null) return;
    setCursorStack((current) => [...current, nextCursor]);
  };

  const handlePreviousPage = () =>
    setCursorStack((current) => (current.length > 1 ? current.slice(0, -1) : current));

  const openForceModal = (userId: string) => {
    setForceModal({ cycle: 'monthly', plan: 'free', reason: '', userId, visible: true });
  };

  const closeForceModal = () => {
    setForceModal((prev) => ({ ...prev, reason: '', visible: false }));
  };

  const handleForceConfirm = async () => {
    const { userId, plan: newPlan, cycle, reason } = forceModal;
    if (!reason.trim()) {
      message.warning(t('admin.subscriptions.reasonRequired', '请填写变更原因'));
      return;
    }
    setSubmitting(true);
    try {
      await adminCommercialService.forceChangePlan({ cycle, plan: newPlan, reason, userId });
      message.success(t('admin.subscriptions.forceSuccess', '套餐已变更'));
      closeForceModal();
      await mutate();
    } catch {
      message.error(t('admin.subscriptions.forceFailed', '变更失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        dataIndex: 'userId',
        key: 'userId',
        render: (uid: string) => <code>{uid?.slice(0, 8)}</code>,
        title: t('admin.subscriptions.columns.userId', '用户 ID'),
      },
      {
        dataIndex: 'plan',
        key: 'plan',
        render: (value: string) => <Tag color={PLAN_COLORS[value] ?? 'default'}>{value}</Tag>,
        title: t('admin.subscriptions.columns.plan', '套餐'),
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: string) => <Tag color={STATUS_COLORS[value] ?? 'default'}>{value}</Tag>,
        title: t('admin.subscriptions.columns.status', '状态'),
      },
      {
        dataIndex: 'cycle',
        key: 'cycle',
        title: t('admin.subscriptions.columns.cycle', '周期'),
      },
      {
        dataIndex: 'monthlyCredits',
        key: 'monthlyCredits',
        render: (value: number) => (value != null ? formatAdminCredits(value) : '--'),
        title: t('admin.subscriptions.columns.monthlyCredits', '每月积分'),
      },
      {
        dataIndex: 'monthlyPrice',
        key: 'monthlyPrice',
        render: (value: number, row: any) =>
          value != null ? formatCurrencyAmount(value, row.currency) : '--',
        title: t('admin.subscriptions.columns.cycleAmount', '周期金额'),
      },
      {
        dataIndex: 'startedAt',
        key: 'startedAt',
        render: (value: string) => formatBusinessDate(value),
        title: t('admin.subscriptions.columns.started', '开始时间'),
      },
      {
        dataIndex: 'renewsAt',
        key: 'renewsAt',
        render: (value: string) => formatBusinessDate(value),
        title: t('admin.subscriptions.columns.renewsAt', '续费时间'),
      },
      {
        key: 'actions',
        render: (_: unknown, row: any) => (
          <Button size="small" type="primary" onClick={() => openForceModal(row.userId)}>
            {t('admin.subscriptions.actions.forceChange', '变更套餐')}
          </Button>
        ),
        title: t('admin.subscriptions.columns.actions', '操作'),
      },
    ],
    [t],
  );

  return (
    <AdminPageShell
      title={t('admin.subscriptions.title', '订阅管理')}
      width="full"
      description={t(
        'admin.subscriptions.description',
        '核对订阅状态、周期与权益，并集中处理人工套餐变更请求。',
      )}
    >
      <Tabs
        items={[
          {
            children: (
              <AdminSection
                title={t('admin.subscriptions.listTitle', '订阅记录')}
                description={t('admin.subscriptions.resultSummary', {
                  count: items.length,
                  defaultValue: '本页显示 {{count}} 条订阅记录',
                })}
              >
                <AdminToolbar>
                  <Select
                    className={styles.filter}
                    value={plan}
                    options={[
                      { label: t('admin.subscriptions.plan.all', '全部'), value: 'all' },
                      {
                        label: t('admin.subscriptions.plan.free', '免费版（Free）'),
                        value: 'free',
                      },
                      {
                        label: t('admin.subscriptions.plan.hobby', '轻量版（Hobby）'),
                        value: 'hobby',
                      },
                      {
                        label: t('admin.subscriptions.plan.starter', '基础版（Starter）'),
                        value: 'starter',
                      },
                      {
                        label: t('admin.subscriptions.plan.premium', '专业版（Premium）'),
                        value: 'premium',
                      },
                      {
                        label: t('admin.subscriptions.plan.ultimate', '旗舰版（Ultimate）'),
                        value: 'ultimate',
                      },
                    ]}
                    onChange={handlePlanFilterChange}
                  />
                </AdminToolbar>

                <AdminResponsiveTable label={t('admin.subscriptions.tableLabel', '订阅数据表')}>
                  {!isLoading && items.length === 0 ? (
                    <Empty description={t('admin.subscriptions.empty', '暂无订阅数据')} />
                  ) : (
                    <InlineTable
                      columns={columns}
                      dataSource={items}
                      loading={isLoading}
                      rowKey="id"
                    />
                  )}
                </AdminResponsiveTable>

                {(cursorStack.length > 1 || nextCursor != null) && (
                  <Flexbox horizontal align="center" gap={8}>
                    <Button disabled={cursorStack.length === 1} onClick={handlePreviousPage}>
                      {t('admin.pagination.previous', '上一页')}
                    </Button>
                    <Button
                      disabled={nextCursor == null}
                      loading={isLoading}
                      onClick={handleNextPage}
                    >
                      {t('admin.pagination.next', '下一页')}
                    </Button>
                  </Flexbox>
                )}

                <Modal
                  confirmLoading={submitting}
                  open={forceModal.visible}
                  title={t('admin.subscriptions.modal.title', '人工变更套餐')}
                  onCancel={closeForceModal}
                  onOk={handleForceConfirm}
                >
                  <Flexbox gap={12}>
                    <Flexbox gap={4}>
                      <div>{t('admin.subscriptions.modal.planLabel', '套餐')}</div>
                      <Select
                        style={{ width: '100%' }}
                        value={forceModal.plan}
                        options={[
                          { label: '免费版（Free）', value: 'free' },
                          { label: '轻量版（Hobby）', value: 'hobby' },
                          { label: '基础版（Starter）', value: 'starter' },
                          { label: '专业版（Premium）', value: 'premium' },
                          { label: '旗舰版（Ultimate）', value: 'ultimate' },
                        ]}
                        onChange={(value: string) =>
                          setForceModal((prev) => ({ ...prev, plan: value }))
                        }
                      />
                    </Flexbox>
                    <Flexbox gap={4}>
                      <div>{t('admin.subscriptions.modal.cycleLabel', '周期')}</div>
                      <Select
                        style={{ width: '100%' }}
                        value={forceModal.cycle}
                        options={ADMIN_SUBSCRIPTION_CYCLES.map((item) => ({
                          label: t(
                            `admin.subscriptions.modal.${item}`,
                            getAdminSubscriptionCycleLabel(item),
                          ),
                          value: item,
                        }))}
                        onChange={(value) => setForceModal((prev) => ({ ...prev, cycle: value }))}
                      />
                    </Flexbox>
                    <Flexbox gap={4}>
                      <div>{t('admin.subscriptions.modal.reasonLabel', '原因')}</div>
                      <Input.TextArea
                        rows={3}
                        value={forceModal.reason}
                        placeholder={t(
                          'admin.subscriptions.modal.reasonPlaceholder',
                          '请输入变更原因...',
                        )}
                        onChange={(event: { target: { value: string } }) =>
                          setForceModal((prev) => ({ ...prev, reason: event.target.value }))
                        }
                      />
                    </Flexbox>
                  </Flexbox>
                </Modal>
              </AdminSection>
            ),
            key: 'subscriptions',
            label: t('admin.subscriptions.tabs.subscriptions', '订阅列表'),
          },
          {
            children: <AdminChangeRequestsPage embedded />,
            key: 'changeRequests',
            label: t('admin.subscriptions.tabs.changeRequests', '变更请求'),
          },
        ]}
      />
    </AdminPageShell>
  );
});

AdminSubscriptionsPage.displayName = 'AdminSubscriptionsPage';

export default AdminSubscriptionsPage;
