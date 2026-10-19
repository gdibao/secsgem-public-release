'use client';

import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLE_IDS,
  type AdminRole,
  hasAdminCapability,
  isFullAdminRole,
} from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { Button, Modal, Select } from '@lobehub/ui/base-ui';
import { Empty, Input, InputNumber, message, Space, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import {
  AdminDangerousActionButton,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
  AdminUserDetailDrawer,
} from '@/features/Admin';
import AdminAssignPlanModal from '@/features/Admin/AdminAssignPlanModal';
import { toAdminAtomicCredits } from '@/features/Admin/adminCreditUnits';
import type { AdminDangerousActionEnvelope } from '@/features/Admin/adminDangerousActions';
import type { AdminSubscriptionCycle } from '@/features/Admin/adminSubscriptionCycles';
import { isFiniteAdminSubscriptionCycle } from '@/features/Admin/adminSubscriptionCycles';
import { AdminPageError } from '@/features/Admin/layout';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

type UserSubscription = {
  cycle: string;
  endsAt: Date | null;
  plan: string;
  startedAt: Date | null;
  status: string;
};

type UserRow = {
  avatar: string | null;
  banned: boolean | null;
  createdAt: Date | null;
  email: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: Date | null;
  phone: string | null;
  role: string | null;
  subscription: UserSubscription | null;
};

const EMPTY_TEXT = '-';

const styles = createStaticStyles(({ css }) => ({
  filter: css`
    width: 180px;

    @media (width < 640px) {
      width: 100%;
    }
  `,
  filters: css`
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  search: css`
    width: min(320px, 100%);
  `,
  sort: css`
    width: 190px;

    @media (width < 640px) {
      width: 100%;
    }
  `,
}));

type AssignableRole = AdminRole | 'user' | '__none__';

const AdminUsersPage = memo(() => {
  const { t } = useTranslation('subscription');
  const role = useUserStore((state) => (userProfileSelectors.userProfile(state) as any)?.role);
  const canImpersonate = hasAdminCapability(role, ADMIN_CAPABILITIES.adminAccess);
  const canManageFinance = hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const canManageSupport = hasAdminCapability(role, ADMIN_CAPABILITIES.supportWrite);
  const canSetRoles = isFullAdminRole(role);
  const roleLabels: Record<AdminRole | 'user', string> = {
    admin: t('admin.roles.admin', '超级管理员'),
    content_admin: t('admin.roles.contentAdmin', '内容管理员'),
    finance_admin: t('admin.roles.financeAdmin', '财务管理员'),
    model_ops: t('admin.roles.modelOps', '模型运营'),
    module_admin: t('admin.roles.moduleAdmin', '模块管理员'),
    support_admin: t('admin.roles.supportAdmin', '用户支持'),
    system_admin: t('admin.roles.systemAdmin', '系统管理员'),
    user: t('admin.roles.user', '普通用户'),
  };
  const roleOptions: Array<{ label: string; value: AssignableRole }> = [
    ...ADMIN_ROLE_IDS.map((value) => ({ label: roleLabels[value], value })),
    { label: roleLabels.user, value: 'user' },
    { label: t('admin.roles.unset', '未设置'), value: '__none__' },
  ];
  const roleLabel = (value: string | null) =>
    value && value in roleLabels ? roleLabels[value as AdminRole | 'user'] : EMPTY_TEXT;
  const [query, setQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<string | undefined>();
  const [subscriptionStartedOrder, setSubscriptionStartedOrder] = useState<'asc' | 'desc'>();
  const [cursor, setCursor] = useState(0);
  const [allItems, setAllItems] = useState<UserRow[]>([]);
  const [banTarget, setBanTarget] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignPlan, setAssignPlan] = useState<string>();
  const [assignCycle, setAssignCycle] = useState<AdminSubscriptionCycle>('monthly');
  const [assignDurationMonths, setAssignDurationMonths] = useState<number>(1);
  const [assignReason, setAssignReason] = useState('');
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AssignableRole>>({});

  const swrKey = ['admin-users', query, planFilter ?? '', subscriptionStartedOrder ?? '', cursor];
  const { data: plansData } = useClientDataSWR(
    canManageFinance ? ['admin-user-list-plan-options'] : null,
    () => adminCommercialService.listPlans(),
  );
  const { data: resetAllToFreePlanPreview, isLoading: resetPreviewLoading } = useClientDataSWR(
    canSetRoles ? ['admin-reset-all-to-free-plan-preview'] : null,
    () => adminCommercialService.getResetAllUsersToFreePlanPreview(),
  );

  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(
    swrKey,
    () =>
      adminCommercialService.listUsers({
        cursor,
        limit: 20,
        plan: planFilter,
        query: query || undefined,
        subscriptionStartedOrder,
      }),
    {
      onSuccess: (result) => {
        if (cursor === 0) {
          setAllItems(result.items as UserRow[]);
        } else {
          setAllItems((prev) => [...prev, ...(result.items as UserRow[])]);
        }
      },
    },
  );

  const resetList = () => {
    setCursor(0);
    setAllItems([]);
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    resetList();
  };

  const handleLoadMore = () => {
    if (data?.nextCursor != null) setCursor(data.nextCursor);
  };

  const invalidate = () => {
    setCursor(0);
    setAllItems([]);
    mutate(['admin-users', query, planFilter ?? '', subscriptionStartedOrder ?? '', 0]);
  };

  const handleBan = async () => {
    if (!banTarget) return;
    setActionLoading(banTarget);
    try {
      await adminCommercialService.banUser({
        banReason: banReason || undefined,
        userId: banTarget,
      });
      message.success(t('admin.ban.success', '用户已封禁'));
      setBanTarget(null);
      setBanReason('');
      invalidate();
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnban = async (userId: string) => {
    setActionLoading(userId);
    try {
      await adminCommercialService.unbanUser(userId);
      message.success(t('admin.unban.success', '用户已解封'));
      invalidate();
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetRole = async (
    userId: string,
    value: string,
    command: AdminDangerousActionEnvelope<'user.setRole'>,
  ) => {
    setActionLoading(`${userId}-role`);
    try {
      const role = value === '__none__' ? null : (value as AdminRole | 'user');
      await adminCommercialService.setUserRole({ role, userId }, command);
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      message.success(t('admin.setRole.success', '角色已更新'));
      invalidate();
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAdjustCredits = async (command: AdminDangerousActionEnvelope<'credits.adjust'>) => {
    const normalizedReason = command.reason?.trim();
    if (!adjustTarget || !normalizedReason || !adjustAmount) {
      message.warning(t('admin.adjustCredits.invalid', '请输入积分数量和调整原因'));
      return;
    }
    setActionLoading(`${adjustTarget}-credits`);
    try {
      await adminCommercialService.adjustCredits(
        {
          amount: toAdminAtomicCredits(adjustAmount),
          reason: normalizedReason,
          userId: adjustTarget,
        },
        command,
      );
      message.success(t('admin.adjustCredits.success', '积分已调整'));
      setAdjustTarget(null);
      setAdjustAmount(0);
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };

  const openAssignPlan = (userId: string) => {
    setAssignTarget(userId);
    setAssignPlan(undefined);
    setAssignCycle('monthly');
    setAssignDurationMonths(1);
    setAssignReason('');
  };

  const closeAssignPlan = () => {
    setAssignTarget(null);
    setAssignPlan(undefined);
    setAssignCycle('monthly');
    setAssignDurationMonths(1);
    setAssignReason('');
  };

  const handleAssignPlan = async () => {
    const durationMonths = isFiniteAdminSubscriptionCycle(assignCycle)
      ? Math.round(assignDurationMonths)
      : 1;
    if (!assignTarget || !assignPlan || durationMonths < 1 || !assignReason.trim()) {
      message.warning(t('admin.assignPlan.invalid', '请选择套餐、使用时长并填写原因'));
      return;
    }

    setActionLoading(`${assignTarget}-plan`);
    try {
      await adminCommercialService.assignUserPlan({
        cycle: assignCycle,
        durationMonths,
        plan: assignPlan,
        reason: assignReason.trim(),
        userId: assignTarget,
      });
      message.success(t('admin.assignPlan.success', '套餐已设置'));
      closeAssignPlan();
      await mutate(['admin-subscriptions']);
      invalidate();
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };
  const handleResetAllToFreePlan = async (
    command: AdminDangerousActionEnvelope<'user.resetAllToFreePlan'>,
  ) => {
    setActionLoading('reset-all-free');
    try {
      const result = await adminCommercialService.resetAllUsersToFreePlan(command);
      message.success(
        t(
          'admin.resetAllToFreePlan.success',
          `已重置：取消 ${result.canceledPaid} 个付费套餐，规范 ${result.normalizedFree} 个免费套餐，新增 ${result.insertedFree} 个免费套餐。`,
        ),
      );
      invalidate();
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleImpersonate = async (
    row: UserRow,
    command: AdminDangerousActionEnvelope<'user.impersonate.attempt'>,
  ) => {
    setActionLoading(`${row.id}-impersonate`);
    try {
      await adminCommercialService.impersonateUser(row.id, command);
      message.success(t('admin.impersonate.success', '已切换用户身份'));
      window.location.assign('/');
    } catch {
      message.error(t('admin.impersonate.failed', '切换用户身份失败'));
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ColumnsType<UserRow> = [
    {
      dataIndex: 'fullName',
      key: 'name',
      render: (name: string | null, row) => (
        <Space>
          <Avatar avatar={row.avatar ?? undefined} size={28} title={name ?? row.email ?? ''} />
          <span>{name ?? EMPTY_TEXT}</span>
        </Space>
      ),
      title: t('admin.name', '姓名'),
    },
    {
      dataIndex: 'email',
      key: 'email',
      render: (value: string | null) => value ?? EMPTY_TEXT,
      title: t('admin.email', '邮箱'),
    },
    {
      dataIndex: 'phone',
      key: 'phone',
      render: (value: string | null) => value ?? EMPTY_TEXT,
      title: t('admin.phone', '手机号'),
    },
    {
      dataIndex: 'subscription',
      key: 'subscription',
      render: (subscription: UserSubscription | null) =>
        subscription ? (
          <Space size={6}>
            <Tag color="blue">{subscription.plan}</Tag>
            <span>
              {subscription.startedAt
                ? new Date(subscription.startedAt).toLocaleDateString()
                : EMPTY_TEXT}
            </span>
          </Space>
        ) : (
          <Tag>{EMPTY_TEXT}</Tag>
        ),
      title: t('admin.currentPlanWithStartedAt', '当前套餐 / 开始时间'),
    },
    {
      dataIndex: 'role',
      key: 'role',
      render: (value: string | null) =>
        value ? (
          <Tag color={value === 'admin' ? 'purple' : 'blue'}>{roleLabel(value)}</Tag>
        ) : (
          <span>{EMPTY_TEXT}</span>
        ),
      title: t('admin.role', '角色'),
    },
    {
      dataIndex: 'banned',
      key: 'status',
      render: (value: boolean | null) =>
        value ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>,
      title: t('admin.status', '状态'),
    },
    {
      dataIndex: 'createdAt',
      key: 'joined',
      render: (value: Date | null) => (value ? new Date(value).toLocaleDateString() : EMPTY_TEXT),
      title: t('admin.joined', '注册时间'),
    },
    {
      dataIndex: 'lastActiveAt',
      key: 'lastActive',
      render: (value: Date | null) => (value ? new Date(value).toLocaleDateString() : EMPTY_TEXT),
      title: t('admin.lastActive', '最近活跃'),
    },
    {
      key: 'actions',
      render: (_: unknown, row: UserRow) => (
        <Space>
          {canManageSupport ? (
            row.banned ? (
              <Button
                loading={actionLoading === row.id}
                size="small"
                onClick={() => handleUnban(row.id)}
              >
                {t('admin.unban', '解封')}
              </Button>
            ) : (
              <Button
                danger
                loading={actionLoading === row.id}
                size="small"
                onClick={() => setBanTarget(row.id)}
              >
                {t('admin.ban', '封禁')}
              </Button>
            )
          ) : null}
          {canSetRoles ? (
            <Space.Compact>
              <Select
                loading={actionLoading === `${row.id}-role`}
                options={roleOptions}
                placeholder={t('admin.setRole', '设置角色')}
                size="small"
                style={{ width: 132 }}
                value={roleDrafts[row.id] ?? ((row.role ?? '__none__') as AssignableRole)}
                onChange={(value) => {
                  if (!value) return;
                  setRoleDrafts((current) => ({
                    ...current,
                    [row.id]: value as AssignableRole,
                  }));
                }}
              />
              <AdminDangerousActionButton
                actionId="user.setRole"
                loading={actionLoading === `${row.id}-role`}
                size="small"
                disabled={
                  (roleDrafts[row.id] ?? ((row.role ?? '__none__') as AssignableRole)) ===
                  ((row.role ?? '__none__') as AssignableRole)
                }
                onConfirm={(command) =>
                  handleSetRole(
                    row.id,
                    roleDrafts[row.id] ?? ((row.role ?? '__none__') as AssignableRole),
                    command,
                  )
                }
              >
                {t('admin.setRole', '设置角色')}
              </AdminDangerousActionButton>
            </Space.Compact>
          ) : null}
          {canManageFinance ? (
            <>
              <Button
                size="small"
                onClick={() => {
                  setAdjustTarget(row.id);
                  setAdjustAmount(0);
                }}
              >
                {t('admin.adjustCredits', '调整积分')}
              </Button>
              <Button
                loading={actionLoading === `${row.id}-plan`}
                size="small"
                onClick={() => openAssignPlan(row.id)}
              >
                {t('admin.assignPlan', '设置套餐')}
              </Button>
            </>
          ) : null}
          {canImpersonate ? (
            <AdminDangerousActionButton
              actionId="user.impersonate.attempt"
              confirmTitle={t('admin.impersonate.confirmTitle', '以该用户身份登录？')}
              loading={actionLoading === `${row.id}-impersonate`}
              size="small"
              confirmDescription={t(
                'admin.impersonate.confirmContent',
                '系统会把当前管理员会话切换为该用户，用于排查套餐、模型和前台体验问题。完成排查后请退出登录并重新登录管理员账号。',
              )}
              onConfirm={(command) => handleImpersonate(row, command)}
            >
              {t('admin.impersonate', '以用户身份登录')}
            </AdminDangerousActionButton>
          ) : null}
          <Button size="small" onClick={() => setDetailUserId(row.id)}>
            {t('admin.viewDetail', '详情')}
          </Button>
        </Space>
      ),
      title: t('admin.actions', '操作'),
    },
  ];

  return (
    <AdminPageShell
      title={t('admin.users.title', '用户与权限')}
      width="full"
      description={t(
        'admin.users.description',
        '查询用户、核对订阅状态，并在权限范围内执行支持、积分和角色管理。',
      )}
    >
      <AdminSection
        title={t('admin.users.listTitle', '用户列表')}
        description={
          t('admin.users.resultSummary', {
            count: allItems.length,
            defaultValue: '当前已加载 {{count}} 位用户',
          }) + (query ? `，${t('admin.search', '搜索')}“${query}”` : '')
        }
      >
        <AdminToolbar>
          <div className={styles.filters}>
            <Input.Search
              allowClear
              className={styles.search}
              placeholder={t('admin.search', '搜索用户')}
              onSearch={handleSearch}
            />
            <Select
              allowClear
              className={styles.filter}
              placeholder={t('admin.filterByPlan', '按套餐筛选')}
              value={planFilter}
              options={(plansData?.items ?? []).map((item: any) => ({
                label: `${item.displayName || item.plan} (${item.plan})`,
                value: item.plan,
              }))}
              onChange={(value: null | string | undefined) => {
                setPlanFilter(value ?? undefined);
                resetList();
              }}
            />
            <Select
              allowClear
              className={styles.sort}
              placeholder={t('admin.subscriptionStartedOrder', '套餐开始时间排序')}
              value={subscriptionStartedOrder}
              options={[
                { label: t('admin.subscriptionStartedOrder.asc', '开始时间正序'), value: 'asc' },
                { label: t('admin.subscriptionStartedOrder.desc', '开始时间倒序'), value: 'desc' },
              ]}
              onChange={(value: 'asc' | 'desc' | null | undefined) => {
                setSubscriptionStartedOrder(value ?? undefined);
                resetList();
              }}
            />
          </div>
          <Button
            disabled={exporting}
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const result = await adminCommercialService.exportUsers({
                  limit: 10_000,
                  query: undefined,
                });
                const header = [
                  'id',
                  'email',
                  'username',
                  'fullName',
                  'phone',
                  'role',
                  'banned',
                  'createdAt',
                  'lastActiveAt',
                ];
                const escape = (value: unknown) => {
                  if (value === null || value === undefined) return '';
                  const text = typeof value === 'string' ? value : JSON.stringify(value);

                  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
                };
                const lines = [header.join(',')];
                for (const user of result.items as any[]) {
                  lines.push(
                    [
                      user.id,
                      user.email,
                      user.username,
                      user.fullName,
                      user.phone,
                      user.role,
                      user.banned,
                      user.createdAt ? new Date(user.createdAt).toISOString() : '',
                      user.lastActiveAt ? new Date(user.lastActiveAt).toISOString() : '',
                    ]
                      .map(escape)
                      .join(','),
                  );
                }
                const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
                const link = document.createElement('a');
                link.download = `admin-users-${new Date().toISOString().slice(0, 10)}.csv`;
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
                message.success(t('admin.exportSuccess', `已导出 ${result.items.length} 条`));
              } catch {
                message.error(t('admin.exportFailed', '导出失败'));
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download aria-hidden size={16} />
            {t('admin.exportCsv', '导出 CSV')}
          </Button>
        </AdminToolbar>
        {error ? (
          <AdminPageError
            description={t('admin.users.loadFailed', '用户列表加载失败，请重试。')}
            onRetry={refresh}
          />
        ) : (
          <AdminResponsiveTable label={t('admin.users.tableLabel', '用户数据表')}>
            <InlineTable
              columns={columns as any}
              dataSource={allItems}
              loading={isLoading && cursor === 0}
              locale={{ emptyText: <Empty description={t('admin.noData', '暂无数据')} /> }}
              rowKey="id"
            />
          </AdminResponsiveTable>
        )}
        {!error && data?.nextCursor != null && (
          <Flexbox align="center">
            <Button loading={isLoading && cursor > 0} onClick={handleLoadMore}>
              {t('admin.loadMore', '加载更多')}
            </Button>
          </Flexbox>
        )}
      </AdminSection>
      {canSetRoles ? (
        <AdminSection
          title={t('admin.users.dangerTitle', '批量危险操作')}
          description={t(
            'admin.users.dangerDescription',
            '批量动作会影响大量用户权益，仅在完成影响预检后执行。',
          )}
        >
          <AdminDangerousActionButton
            danger
            actionId="user.resetAllToFreePlan"
            loading={actionLoading === 'reset-all-free' || resetPreviewLoading}
            confirmDescription={
              <Flexbox gap={8}>
                <div>
                  {t(
                    'admin.resetAllToFreePlan.confirmContent',
                    '这会取消所有当前付费套餐，并确保每个用户都有一个无限期免费套餐。用户已有积分余额不会被清零。',
                  )}
                </div>
                {resetAllToFreePlanPreview ? (
                  <div>
                    {t(
                      'admin.resetAllToFreePlan.preview',
                      `预计影响：取消 ${resetAllToFreePlanPreview.canceledPaid} 个付费套餐，规范 ${resetAllToFreePlanPreview.normalizedFree} 个免费套餐，补充 ${resetAllToFreePlanPreview.insertedFree} 个免费套餐。`,
                    )}
                  </div>
                ) : null}
              </Flexbox>
            }
            onConfirm={handleResetAllToFreePlan}
          >
            {t('admin.resetAllToFreePlan', '重置所有用户为免费套餐')}
          </AdminDangerousActionButton>
        </AdminSection>
      ) : null}
      <Modal
        confirmLoading={actionLoading === banTarget}
        open={!!banTarget}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        title={t('admin.ban', '封禁用户')}
        onOk={handleBan}
        onCancel={() => {
          setBanTarget(null);
          setBanReason('');
        }}
      >
        <Input.TextArea
          placeholder={t('admin.ban.reason', '请输入封禁原因')}
          rows={3}
          value={banReason}
          onChange={(event: { target: { value: string } }) => setBanReason(event.target.value)}
        />
      </Modal>
      <Modal
        open={!!adjustTarget}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        title={t('admin.adjustCredits', '调整积分')}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setAdjustTarget(null);
              setAdjustAmount(0);
            }}
          >
            {t('cancel', '取消')}
          </Button>,
          <AdminDangerousActionButton
            actionId="credits.adjust"
            key="confirm"
            loading={actionLoading === `${adjustTarget ?? ''}-credits`}
            type="primary"
            onConfirm={handleAdjustCredits}
          >
            {t('admin.adjustCredits', '调整积分')}
          </AdminDangerousActionButton>,
        ]}
        onCancel={() => {
          setAdjustTarget(null);
          setAdjustAmount(0);
        }}
      >
        <Flexbox gap={12}>
          <Flexbox gap={4}>
            <div>{t('admin.adjustCredits.amount', '积分数量（可输入负数扣减）')}</div>
            <InputNumber
              addonAfter={'M'}
              precision={6}
              style={{ width: '100%' }}
              value={adjustAmount}
              onChange={(value: number | null) => setAdjustAmount(Number(value ?? 0))}
            />
          </Flexbox>
        </Flexbox>
      </Modal>
      {canManageFinance ? (
        <AdminAssignPlanModal
          confirmLoading={actionLoading === `${assignTarget ?? ''}-plan`}
          cycle={assignCycle}
          durationMonths={assignDurationMonths}
          open={!!assignTarget}
          plan={assignPlan}
          plans={plansData?.items ?? []}
          reason={assignReason}
          title={t('admin.assignPlan.title', '设置用户套餐')}
          onCancel={closeAssignPlan}
          onCycleChange={setAssignCycle}
          onDurationMonthsChange={setAssignDurationMonths}
          onOk={handleAssignPlan}
          onPlanChange={setAssignPlan}
          onReasonChange={setAssignReason}
        />
      ) : null}
      <AdminUserDetailDrawer userId={detailUserId} onClose={() => setDetailUserId(null)} />
    </AdminPageShell>
  );
});

AdminUsersPage.displayName = 'AdminUsersPage';

export default AdminUsersPage;
