'use client';

import { Flexbox } from '@lobehub/ui';
import { Input, InputNumber, Modal, Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ADMIN_SUBSCRIPTION_CYCLES,
  type AdminSubscriptionCycle,
  getAdminSubscriptionCycleLabel,
  isFiniteAdminSubscriptionCycle,
} from './adminSubscriptionCycles';

type AssignPlanCycle = AdminSubscriptionCycle;

export type AdminAssignPlanModalPlan = {
  displayName?: string | null;
  isActive?: boolean | null;
  plan: string;
};

type AdminAssignPlanModalProps = {
  confirmLoading?: boolean;
  cycle: AssignPlanCycle;
  durationMonths: number | null;
  onCancel: () => void;
  onCycleChange: (cycle: AssignPlanCycle) => void;
  onDurationMonthsChange: (durationMonths: number) => void;
  onOk: () => void;
  onPlanChange: (plan: string) => void;
  onReasonChange: (reason: string) => void;
  open: boolean;
  plan?: string;
  plans?: AdminAssignPlanModalPlan[];
  reason: string;
  title?: string;
};

const AdminAssignPlanModal = memo<AdminAssignPlanModalProps>(
  ({
    confirmLoading,
    cycle,
    durationMonths,
    onCancel,
    onCycleChange,
    onDurationMonthsChange,
    onOk,
    onPlanChange,
    onReasonChange,
    open,
    plan,
    plans = [],
    reason,
    title,
  }) => {
    const { t } = useTranslation('subscription');
    const isFiniteCycle = isFiniteAdminSubscriptionCycle(cycle);

    return (
      <Modal
        confirmLoading={confirmLoading}
        open={open}
        title={title ?? t('admin.assignPlan.title', '设置用户套餐')}
        onCancel={onCancel}
        onOk={onOk}
      >
        <Flexbox gap={12}>
          <Flexbox gap={4}>
            <div>{t('admin.assignPlan.plan', '套餐')}</div>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('admin.assignPlan.plan.placeholder', '选择套餐')}
              style={{ width: '100%' }}
              value={plan}
              options={plans
                .filter((item) => item.isActive !== false)
                .map((item) => ({
                  label: `${item.displayName || item.plan} (${item.plan})`,
                  value: item.plan,
                }))}
              onChange={onPlanChange}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <div>{t('admin.assignPlan.cycle', '周期')}</div>
            <Select<AssignPlanCycle>
              style={{ width: '100%' }}
              value={cycle}
              options={ADMIN_SUBSCRIPTION_CYCLES.map((item) => ({
                label: t(`admin.assignPlan.${item}`, getAdminSubscriptionCycleLabel(item)),
                value: item,
              }))}
              onChange={onCycleChange}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <div>{t('admin.assignPlan.durationMonths', '使用时长（月）')}</div>
            <InputNumber
              disabled={!isFiniteCycle}
              max={120}
              min={1}
              precision={0}
              style={{ width: '100%' }}
              value={isFiniteCycle ? durationMonths : null}
              placeholder={t('admin.assignPlan.durationLifetime', '终身套餐无需填写')}
              onChange={(value: number | null) => onDurationMonthsChange(Number(value ?? 1))}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <div>{t('admin.assignPlan.reason', '原因')}</div>
            <Input.TextArea
              rows={3}
              value={reason}
              placeholder={t(
                'admin.assignPlan.reason.placeholder',
                '例如：线下购买、客服补偿、测试账号等',
              )}
              onChange={(event: { target: { value: string } }) =>
                onReasonChange(event.target.value)
              }
            />
          </Flexbox>
        </Flexbox>
      </Modal>
    );
  },
);

AdminAssignPlanModal.displayName = 'AdminAssignPlanModal';

export default AdminAssignPlanModal;
