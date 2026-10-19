'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  InputNumber,
  message,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
} from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate as swrMutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AdminAssignPlanModal from './AdminAssignPlanModal';
import { formatAdminCredits, toAdminAtomicCredits } from './adminCreditUnits';
import AdminDangerousActionButton from './AdminDangerousActionButton';
import type { AdminDangerousActionEnvelope } from './adminDangerousActions';
import type { AdminSubscriptionCycle } from './adminSubscriptionCycles';
import { isFiniteAdminSubscriptionCycle } from './adminSubscriptionCycles';

interface AdminUserDetailDrawerProps {
  onClose: () => void;
  userId: string | null;
}

const EMPTY_TEXT = '-';

const AdminUserDetailDrawer = memo<AdminUserDetailDrawerProps>(({ onClose, userId }) => {
  const { t } = useTranslation('subscription');
  const role = useUserStore((state) => (userProfileSelectors.userProfile(state) as any)?.role);
  const canManageFinance = hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const canReadFullDetail = hasAdminCapability(role, ADMIN_CAPABILITIES.supportWrite);
  const fullDetailSWRKey = userId && canReadFullDetail ? ['admin-user-full-detail', userId] : null;
  const compactDetailSWRKey = userId && !canReadFullDetail ? ['admin-user-compact-detail', userId] : null;
  const { data: fullDetail, isLoading: fullDetailLoading } = useClientDataSWR(fullDetailSWRKey, () =>
    adminCommercialService.getUserFullDetail(userId!),
  );
  const { data: compactDetail, isLoading: compactDetailLoading } = useClientDataSWR(
    compactDetailSWRKey,
    () => adminCommercialService.getCompactUserDetail(userId!),
  );
  const data = fullDetail;
  const isLoading = fullDetailLoading || compactDetailLoading;
  const swrKey = fullDetailSWRKey ?? compactDetailSWRKey;
  const { data: plansData } = useClientDataSWR(
    canManageFinance ? ['admin-plan-catalog-options'] : null,
    () => adminCommercialService.listPlans(),
  );
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number | null>(0);
  const [adjusting, setAdjusting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPlan, setAssignPlan] = useState<string>();
  const [assignCycle, setAssignCycle] = useState<AdminSubscriptionCycle>('monthly');
  const [assignDurationMonths, setAssignDurationMonths] = useState<number | null>(1);
  const [assignReason, setAssignReason] = useState('');
  const [assigning, setAssigning] = useState(false);

  const handleAdjust = async (command: AdminDangerousActionEnvelope<'credits.adjust'>) => {
    const normalizedReason = command.reason?.trim();
    if (!userId || !adjustAmount || !normalizedReason) {
      message.warning(t('admin.adjustCredits.invalid', '请填写调整数量和原因'));
      return;
    }
    setAdjusting(true);
    try {
      await adminCommercialService.adjustCredits(
        {
          amount: toAdminAtomicCredits(adjustAmount),
          reason: normalizedReason,
          userId,
        },
        command,
      );
      message.success(t('admin.adjustCredits.success', '积分已调整'));
      setAdjustOpen(false);
      setAdjustAmount(0);
      if (swrKey) await swrMutate(swrKey);
    } catch {
      message.error(t('admin.adjustCredits.failed', '操作失败'));
    } finally {
      setAdjusting(false);
    }
  };

  const handleAssignPlan = async () => {
    const durationMonths = isFiniteAdminSubscriptionCycle(assignCycle)
      ? Math.round(assignDurationMonths ?? 0)
      : 1;
    if (!userId || !assignPlan || durationMonths < 1 || !assignReason.trim()) {
      message.warning(t('admin.assignPlan.invalid', '请选择套餐、使用时长并填写原因'));
      return;
    }

    setAssigning(true);
    try {
      await adminCommercialService.assignUserPlan({
        cycle: assignCycle,
        durationMonths,
        plan: assignPlan,
        reason: assignReason.trim(),
        userId,
      });
      message.success(t('admin.assignPlan.success', '套餐已设置'));
      setAssignOpen(false);
      setAssignReason('');
      if (swrKey) await swrMutate(swrKey);
      await swrMutate(['admin-subscriptions']);
    } catch {
      message.error(t('admin.error.generic', '操作失败，请稍后重试'));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Drawer
      destroyOnClose
      open={!!userId}
      title={t('admin.userDetail.title', '用户详情')}
      width={720}
      extra={
        userId && canManageFinance ? (
          <Space>
            <Button onClick={() => setAssignOpen(true)}>
              {t('admin.userDetail.assignPlan', '给用户分配套餐')}
            </Button>
            <Button type="primary" onClick={() => setAdjustOpen(true)}>
              {t('admin.adjustCredits', '调整积分')}
            </Button>
          </Space>
        ) : null
      }
      onClose={onClose}
    >
      {isLoading ? (
        <Spin />
      ) : data ? (
        <Flexbox gap={24}>
          <Descriptions
            bordered
            column={1}
            size="small"
            title={t('admin.userDetail.profile', '用户资料')}
          >
            <Descriptions.Item label={t('admin.userDetail.userId', 'ID')}>
              <code>{data.user.id}</code>
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.email', '邮箱')}>
              {data.user.email ?? EMPTY_TEXT}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.phone', '手机号')}>
              {data.user.phone ?? EMPTY_TEXT}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.name', '名称')}>
              {data.user.fullName ?? EMPTY_TEXT}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.role', '角色')}>
              {data.user.role ? (
                <Tag color={data.user.role === 'admin' ? 'purple' : 'blue'}>{data.user.role}</Tag>
              ) : (
                EMPTY_TEXT
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.status', '状态')}>
              {data.user.banned ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.joined', '注册时间')}>
              {data.user.createdAt ? new Date(data.user.createdAt).toLocaleString() : EMPTY_TEXT}
            </Descriptions.Item>
          </Descriptions>

          <Descriptions
            bordered
            column={2}
            size="small"
            title={t('admin.userDetail.balance', '积分余额')}
          >
            <Descriptions.Item label={t('admin.userDetail.balanceCurrent', '当前余额')}>
              {formatAdminCredits(data.creditAccount?.balance)}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.userDetail.totalCredited', '累计增加')}>
              {formatAdminCredits(data.creditAccount?.totalCredited)}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.userDetail.totalDebited', '累计扣减')}>
              {formatAdminCredits(data.creditAccount?.totalDebited)}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.userDetail.currency', '币种')}>
              {data.creditAccount?.currency ?? 'credits'}
            </Descriptions.Item>
          </Descriptions>

          {data.subscription ? (
            <Descriptions
              bordered
              column={2}
              size="small"
              title={t('admin.userDetail.subscription', '订阅')}
            >
              <Descriptions.Item label={t('admin.userDetail.plan', '套餐')}>
                <Tag>{data.subscription.plan}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.cycle', '周期')}>
                {data.subscription.cycle}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.subStatus', '状态')}>
                {data.subscription.status}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.monthlyCredits', '每月积分')}>
                {formatAdminCredits(data.subscription.monthlyCredits)}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.cycleAmount', '周期金额')}>
                {data.subscription.monthlyPrice} {data.subscription.currency}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.renewsAt', '续费时间')}>
                {data.subscription.renewsAt
                  ? new Date(data.subscription.renewsAt).toLocaleDateString()
                  : EMPTY_TEXT}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.userDetail.endTime', '结束时间')}>
                {data.subscription.endsAt
                  ? new Date(data.subscription.endsAt).toLocaleDateString()
                  : EMPTY_TEXT}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty description={t('admin.userDetail.noSubscription', '暂无订阅')} />
          )}

          <div>
            <h4>{t('admin.userDetail.recentLedger', '最近积分流水')}</h4>
            <Table
              dataSource={data.recentLedger}
              pagination={false}
              rowKey="id"
              size="small"
              columns={[
                { dataIndex: 'type', key: 'type', title: t('admin.userDetail.ledgerType', '类型') },
                {
                  dataIndex: 'amount',
                  key: 'amount',
                  render: (value: number) => formatAdminCredits(value),
                  title: t('admin.userDetail.ledgerAmount', '数量'),
                },
                {
                  dataIndex: 'balanceAfter',
                  key: 'balanceAfter',
                  render: (value: number) => formatAdminCredits(value),
                  title: t('admin.userDetail.ledgerBalanceAfter', '变动后余额'),
                },
                {
                  dataIndex: 'description',
                  key: 'description',
                  title: t('admin.userDetail.ledgerDescription', '描述'),
                },
                {
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: (value: Date) => new Date(value).toLocaleString(),
                  title: t('admin.userDetail.ledgerTime', '时间'),
                },
              ]}
            />
          </div>

          <div>
            <h4>{t('admin.userDetail.recentOrders', '最近充值订单')}</h4>
            <Table
              dataSource={data.recentOrders}
              pagination={false}
              rowKey="id"
              size="small"
              columns={[
                {
                  dataIndex: 'id',
                  key: 'id',
                  render: (value: string) => <code>{value.slice(0, 8)}</code>,
                  title: t('admin.userDetail.orderId', 'ID'),
                },
                {
                  dataIndex: 'credits',
                  key: 'credits',
                  render: (value: number) => formatAdminCredits(value),
                  title: t('admin.userDetail.orderCredits', '积分'),
                },
                {
                  dataIndex: 'amount',
                  key: 'amount',
                  title: t('admin.userDetail.orderAmount', '金额'),
                },
                {
                  dataIndex: 'currency',
                  key: 'currency',
                  title: t('admin.userDetail.orderCurrency', '币种'),
                },
                {
                  dataIndex: 'status',
                  key: 'status',
                  render: (value: string) => <Tag>{value}</Tag>,
                  title: t('admin.userDetail.orderStatus', '状态'),
                },
                {
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: (value: Date) => new Date(value).toLocaleString(),
                  title: t('admin.userDetail.orderCreatedAt', '创建时间'),
                },
              ]}
            />
          </div>

          <div>
            <h4>{t('admin.userDetail.auditTrail', '最近后台操作')}</h4>
            <Table
              dataSource={data.recentAudit ?? []}
              pagination={false}
              rowKey="id"
              size="small"
              columns={[
                {
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: (value: Date) => new Date(value).toLocaleString(),
                  title: t('admin.userDetail.auditTime', '时间'),
                  width: 160,
                },
                {
                  dataIndex: 'action',
                  key: 'action',
                  render: (value: string) => <Tag>{value}</Tag>,
                  title: t('admin.userDetail.auditAction', '操作'),
                },
                {
                  dataIndex: 'actorUserId',
                  key: 'actor',
                  render: (value: string | null) =>
                    value ? <code>{value.slice(0, 8)}</code> : EMPTY_TEXT,
                  title: t('admin.userDetail.auditActor', '操作者'),
                },
                {
                  dataIndex: 'payload',
                  key: 'payload',
                  render: (value: Record<string, unknown> | null) =>
                    value ? (
                      <code style={{ fontSize: 11 }}>{JSON.stringify(value).slice(0, 80)}</code>
                    ) : (
                      EMPTY_TEXT
                    ),
                  title: t('admin.userDetail.auditPayload', '载荷（Payload）'),
                },
              ]}
            />
          </div>
        </Flexbox>
      ) : compactDetail ? (
        <Descriptions
          bordered
          column={1}
          size="small"
          title={t('admin.userDetail.profile', '用户资料')}
        >
          <Descriptions.Item label={t('admin.userDetail.userId', 'ID')}>
            <code>{compactDetail.id}</code>
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.role', '角色')}>
            {compactDetail.role ? (
              <Tag color={compactDetail.role === 'admin' ? 'purple' : 'blue'}>
                {compactDetail.role}
              </Tag>
            ) : (
              EMPTY_TEXT
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.status', '状态')}>
            {compactDetail.banned ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.joined', '注册时间')}>
            {compactDetail.createdAt
              ? new Date(compactDetail.createdAt).toLocaleString()
              : EMPTY_TEXT}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Empty />
      )}
      {canManageFinance ? (
        <AdminAssignPlanModal
          confirmLoading={assigning}
          cycle={assignCycle}
          durationMonths={assignDurationMonths}
          open={assignOpen}
          plan={assignPlan}
          plans={plansData?.items ?? []}
          reason={assignReason}
          title={t('admin.userDetail.assignPlan', '给用户分配套餐')}
          onCancel={() => setAssignOpen(false)}
          onCycleChange={setAssignCycle}
          onDurationMonthsChange={setAssignDurationMonths}
          onOk={handleAssignPlan}
          onPlanChange={setAssignPlan}
          onReasonChange={setAssignReason}
        />
      ) : null}
      {canManageFinance ? (
        <Modal
          open={adjustOpen}
          title={t('admin.adjustCredits', '调整积分')}
          footer={[
            <Button
              key="cancel"
              onClick={() => {
                setAdjustOpen(false);
                setAdjustAmount(0);
              }}
            >
              {t('cancel', '取消')}
            </Button>,
            <AdminDangerousActionButton
              actionId="credits.adjust"
              key="confirm"
              loading={adjusting}
              type="primary"
              onConfirm={handleAdjust}
            >
              {t('admin.adjustCredits', '调整积分')}
            </AdminDangerousActionButton>,
          ]}
          onCancel={() => setAdjustOpen(false)}
        >
          <Flexbox gap={12}>
            <div>{t('admin.adjustCredits.amount', '数量（正数增加，负数扣减）')}</div>
            <InputNumber
              addonAfter={'M'}
              precision={6}
              style={{ width: '100%' }}
              value={adjustAmount}
              onChange={(value: number | null) => setAdjustAmount(value ?? 0)}
            />
          </Flexbox>
        </Modal>
      ) : null}
    </Drawer>
  );
});

AdminUserDetailDrawer.displayName = 'AdminUserDetailDrawer';

export default AdminUserDetailDrawer;
