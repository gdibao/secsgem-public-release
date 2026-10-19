'use client';

import { Plans } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Modal, Select } from '@lobehub/ui/base-ui';
import {
  Alert,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Switch,
  Tag,
} from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import InlineTable from '@/components/InlineTable';
import { normalizePlanCatalogPresentation } from '@/const/billingPresentation';
import {
  formatAdminCredits,
  toAdminAtomicCredits,
  toAdminDisplayCredits,
} from '@/features/Admin/adminCreditUnits';
import AdminDependencyImpactPreview from '@/features/Admin/AdminDependencyImpactPreview';
import AdminPlanFaqCard from '@/features/Admin/AdminPlanFaqCard';
import {
  ADMIN_PLAN_MODEL_MATRIX_PATH,
  type AdminPlanModelRules,
  getPlanModelRulesSummaryInfo,
} from '@/features/Admin/adminPlanModelRules';
import {
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
} from '@/features/Admin/layout';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

type PlanRow = {
  currency: string;
  displayName: string;
  features: string[] | null;
  isActive: boolean;
  modelRules: AdminPlanModelRules | null;
  monthlyCredits: number;
  monthlyPrice: number;
  metadata?: {
    badge?: string;
    comparisonNote?: string;
    lifetimePrice?: null | number;
    oneTimePrice?: null | number;
    pptCreditCost?: number;
    pptEnabled?: boolean;
    pptMonthlyQuota?: null | number;
    purchaseUrl?: string;
    storageQuotaMb?: null | number;
    vectorQuota?: null | number;
    yearlyDiscountLabel?: string;
  } | null;
  plan: string;
  sortOrder: number;
  yearlyPrice: number;
};

type PlanFormValues = {
  badge?: string;
  comparisonNote?: string;
  currency?: string;
  displayName: string;
  features?: string;
  isActive?: boolean;
  lifetimePrice?: null | number;
  monthlyCredits?: number;
  monthlyPrice?: number;
  oneTimePrice?: null | number;
  plan: Plans;
  pptCreditCost?: number;
  pptEnabled?: boolean;
  pptMonthlyQuota?: null | number;
  purchaseUrl?: string;
  sortOrder?: number;
  storageQuotaMb?: null | number;
  vectorQuota?: null | number;
  yearlyDiscountLabel?: string;
  yearlyPrice?: number;
};

const SWR_KEY = ['admin-plans'];
const PLAN_OPTIONS = Object.values(Plans).map((plan) => ({
  label: plan,
  value: plan,
}));

const AdminPlansPage = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(SWR_KEY, () => adminCommercialService.listPlans());
  const [editing, setEditing] = useState<Partial<PlanRow> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<PlanFormValues>();

  const items = (data?.items ?? []) as PlanRow[];

  const openEdit = (row?: PlanRow) => {
    const init = row ?? {
      currency: 'USD',
      displayName: '',
      features: [],
      isActive: true,
      monthlyCredits: 0,
      monthlyPrice: 0,
      metadata: {},
      plan: '',
      sortOrder: 0,
      yearlyPrice: 0,
    };

    setEditing(init);
    const metadata = init.metadata as PlanRow['metadata'];
    const presentation = normalizePlanCatalogPresentation(metadata);

    form.setFieldsValue({
      ...init,
      badge: presentation.badge,
      comparisonNote: presentation.comparisonNote,
      features: (init.features ?? []).join('\n'),
      lifetimePrice: metadata?.lifetimePrice ?? null,
      monthlyCredits: toAdminDisplayCredits(init.monthlyCredits),
      oneTimePrice: metadata?.oneTimePrice ?? null,
      pptCreditCost: Number(metadata?.pptCreditCost ?? 0),
      pptEnabled: metadata?.pptEnabled === true,
      pptMonthlyQuota: metadata?.pptMonthlyQuota ?? null,
      purchaseUrl: metadata?.purchaseUrl ?? '',
      storageQuotaMb: metadata?.storageQuotaMb ?? null,
      vectorQuota: metadata?.vectorQuota ?? null,
      yearlyDiscountLabel: presentation.yearlyDiscountLabel,
    } as PlanFormValues);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const features = String(values.features || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);

      await adminCommercialService.upsertPlan({
        badge: values.badge?.trim() || undefined,
        comparisonNote: values.comparisonNote?.trim() || undefined,
        currency: values.currency || 'USD',
        displayName: values.displayName,
        features,
        isActive: !!values.isActive,
        lifetimePrice:
          values.lifetimePrice === null || values.lifetimePrice === undefined
            ? null
            : Number(values.lifetimePrice),
        monthlyCredits: toAdminAtomicCredits(values.monthlyCredits),
        monthlyPrice: Number(values.monthlyPrice || 0),
        oneTimePrice:
          values.oneTimePrice === null || values.oneTimePrice === undefined
            ? null
            : Number(values.oneTimePrice),
        plan: values.plan,
        pptCreditCost: Number(values.pptCreditCost || 0),
        pptEnabled: values.pptEnabled === true,
        pptMonthlyQuota:
          values.pptMonthlyQuota === null || values.pptMonthlyQuota === undefined
            ? null
            : Number(values.pptMonthlyQuota),
        purchaseUrl: values.purchaseUrl?.trim() || undefined,
        sortOrder: Number(values.sortOrder || 0),
        storageQuotaMb:
          values.storageQuotaMb === null || values.storageQuotaMb === undefined
            ? null
            : Number(values.storageQuotaMb),
        vectorQuota:
          values.vectorQuota === null || values.vectorQuota === undefined
            ? null
            : Number(values.vectorQuota),
        yearlyDiscountLabel: values.yearlyDiscountLabel?.trim() || undefined,
        yearlyPrice: Number(values.yearlyPrice || 0),
      });
      message.success(t('admin.plans.saveSuccess', '套餐已保存'));
      setEditing(null);
      await mutate(SWR_KEY);
    } catch {
      message.error(t('admin.plans.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (plan: string) => {
    const impact = await adminCommercialService.getPlanDeleteImpact(plan);

    confirmModal({
      content: <AdminDependencyImpactPreview impact={impact} />,
      okButtonProps: { danger: true, disabled: !impact.canProceed },
      onOk: async () => {
        await adminCommercialService.deletePlan(plan);
        message.success(t('admin.plans.deleted', '套餐已删除'));
        await mutate(SWR_KEY);
      },
      title: t('admin.plans.confirmDelete', '确认删除套餐？'),
    });
  };

  const handleToggleActive = async (row: PlanRow) => {
    await adminCommercialService.setPlanActive({ isActive: !row.isActive, plan: row.plan });
    await mutate(SWR_KEY);
  };

  const columns = [
    { dataIndex: 'plan', key: 'plan', title: t('admin.plans.col.key', '键名') },
    { dataIndex: 'displayName', key: 'displayName', title: t('admin.plans.col.name', '显示名称') },
    {
      dataIndex: 'monthlyCredits',
      key: 'monthlyCredits',
      render: (value: number) => formatAdminCredits(value),
      title: t('admin.plans.col.monthlyCredits', '每月积分'),
    },
    {
      dataIndex: 'monthlyPrice',
      key: 'monthlyPrice',
      render: (value: number, row: PlanRow) => `${value} ${row.currency}`,
      title: t('admin.plans.col.monthly', '月付'),
    },
    {
      dataIndex: 'yearlyPrice',
      key: 'yearlyPrice',
      render: (value: number, row: PlanRow) => `${value} ${row.currency}`,
      title: t('admin.plans.col.yearly', '年付'),
    },
    {
      dataIndex: 'metadata',
      key: 'presentation',
      render: (metadata: PlanRow['metadata']) => {
        const presentation = normalizePlanCatalogPresentation(metadata);

        return (
          <Flexbox horizontal gap={4} wrap="wrap">
            {presentation.badge ? <Tag color="gold">{presentation.badge}</Tag> : null}
            {presentation.yearlyDiscountLabel ? (
              <Tag color="green">{presentation.yearlyDiscountLabel}</Tag>
            ) : null}
            {presentation.comparisonNote ? <Tag color="blue">对比说明</Tag> : null}
            {!presentation.badge &&
            !presentation.yearlyDiscountLabel &&
            !presentation.comparisonNote ? (
              <Tag>未设置</Tag>
            ) : null}
          </Flexbox>
        );
      },
      title: t('admin.plans.col.presentation', '展示设置'),
    },
    {
      dataIndex: 'metadata',
      key: 'purchaseUrl',
      render: (metadata: PlanRow['metadata']) =>
        metadata?.purchaseUrl ? <Tag color="blue">已设置</Tag> : <Tag>未设置</Tag>,
      title: t('admin.plans.col.purchaseUrl', '购买链接'),
    },
    {
      dataIndex: 'metadata',
      key: 'quotas',
      render: (metadata: PlanRow['metadata']) => (
        <Flexbox gap={4}>
          <Tag>
            存储{' '}
            {metadata?.storageQuotaMb === null || metadata?.storageQuotaMb === undefined
              ? '不限'
              : `${metadata.storageQuotaMb} MB`}
          </Tag>
          <Tag>
            向量{' '}
            {metadata?.vectorQuota === null || metadata?.vectorQuota === undefined
              ? '不限'
              : metadata.vectorQuota}
          </Tag>
        </Flexbox>
      ),
      title: t('admin.plans.col.quotas', '资源限制'),
    },
    {
      dataIndex: 'metadata',
      key: 'ppt',
      render: (metadata: PlanRow['metadata']) =>
        metadata?.pptEnabled ? (
          <Tag color="purple">
            PPT {metadata.pptMonthlyQuota ?? '不限'} / {metadata.pptCreditCost ?? 0} 积分
          </Tag>
        ) : (
          <Tag>未启用</Tag>
        ),
      title: t('admin.plans.col.ppt', 'PPT 权益'),
    },
    {
      dataIndex: 'isActive',
      key: 'isActive',
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
      title: t('admin.plans.col.active', '状态'),
    },
    {
      dataIndex: 'modelRules',
      key: 'modelRules',
      render: (rules: AdminPlanModelRules | null) => {
        const summary = getPlanModelRulesSummaryInfo(rules);

        return (
          <Flexbox gap={4}>
            <Tag color={summary.hasRules ? 'orange' : 'green'}>{summary.label}</Tag>
            {summary.allowlistTypeCount > 0 ? (
              <Tag>
                白名单 {summary.allowlistTypeCount} 类 / {summary.allowlistEntryCount} 项
              </Tag>
            ) : null}
            {summary.blocklistTypeCount > 0 ? (
              <Tag>
                黑名单 {summary.blocklistTypeCount} 类 / {summary.blocklistEntryCount} 项
              </Tag>
            ) : null}
          </Flexbox>
        );
      },
      title: t('admin.plans.col.modelRules', '模型权限'),
    },
    {
      key: 'actions',
      render: (_: unknown, row: PlanRow) => (
        <Flexbox horizontal gap={8}>
          <Button size="small" onClick={() => navigate(ADMIN_PLAN_MODEL_MATRIX_PATH)}>
            {t('admin.plans.modelRules', '去矩阵配置')}
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            {t('admin.plans.edit', '编辑')}
          </Button>
          <Button size="small" onClick={() => handleToggleActive(row)}>
            {row.isActive ? t('admin.plans.deactivate', '停用') : t('admin.plans.activate', '启用')}
          </Button>
          <Button danger size="small" onClick={() => handleDelete(row.plan)}>
            {t('admin.plans.delete', '删除')}
          </Button>
        </Flexbox>
      ),
      title: t('admin.plans.col.actions', '操作'),
    },
  ];

  return (
    <AdminPageShell
      description={t('admin.plans.description', '维护订阅套餐的价格、积分、权益和展示信息。')}
      title={t('admin.plans.title', '套餐管理')}
      width="full"
    >
      <AdminSection>
        <Alert
          showIcon
          type="info"
          action={
            <Button size="small" onClick={() => navigate(ADMIN_PLAN_MODEL_MATRIX_PATH)}>
              打开矩阵
            </Button>
          }
          message={t(
            'admin.plans.modelRulesMoved',
            '套餐模型权限已统一移动到“模型与计费矩阵”。此页只维护套餐价格、积分和权益，避免同一权限在多个入口重复编辑。',
          )}
        />

        <AdminToolbar>
          <Button disabled={isLoading || Boolean(error)} type="primary" onClick={() => openEdit()}>
            {t('admin.plans.create', '新建套餐')}
          </Button>
        </AdminToolbar>

        {error ? (
          <AdminPageError
            description={t('admin.plans.loadFailed', '套餐加载失败，请重试。')}
            onRetry={refresh}
          />
        ) : !isLoading && items.length === 0 ? (
          <Empty description={t('admin.plans.empty', '暂无套餐配置')} />
        ) : (
          <AdminResponsiveTable label={t('admin.plans.tableLabel', '套餐配置表')}>
            <InlineTable
              columns={columns as any}
              dataSource={items}
              loading={isLoading}
              rowKey="plan"
            />
          </AdminResponsiveTable>
        )}
      </AdminSection>

      <AdminSection title={t('admin.plans.faqTitle', '套餐配置说明')}>
        <AdminPlanFaqCard />
      </AdminSection>

      <Modal
        confirmLoading={submitting}
        open={!!editing}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        width={600}
        title={
          editing?.plan
            ? t('admin.plans.modal.edit', '编辑套餐')
            : t('admin.plans.modal.create', '新建套餐')
        }
        onCancel={() => setEditing(null)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label={t('admin.plans.field.key', '套餐键名')}
            name="plan"
            rules={[{ required: true }]}
          >
            <Select
              disabled={!!editing?.plan}
              options={PLAN_OPTIONS}
              placeholder={t('admin.plans.field.keyPlaceholder', '请选择一个内置支持的套餐键名')}
            />
          </Form.Item>
          <Form.Item
            label={t('admin.plans.field.name', '显示名称')}
            name="displayName"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              label={t('admin.plans.field.monthlyCredits', '每月积分')}
              name="monthlyCredits"
              style={{ flex: 1 }}
            >
              <InputNumber addonAfter={'M'} min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.currency', '币种')}
              name="currency"
              style={{ width: 120 }}
            >
              <Input />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              label={t('admin.plans.field.monthly', '月付价格')}
              name="monthlyPrice"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.yearly', '年付价格')}
              name="yearlyPrice"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              extra={t('admin.plans.field.oneTimeHint', '留空时前台不展示一次性周期。')}
              label={t('admin.plans.field.oneTime', '一次性价格')}
              name="oneTimePrice"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              extra={t('admin.plans.field.lifetimeHint', '留空时前台不展示终身周期。')}
              label={t('admin.plans.field.lifetime', '终身价格')}
              name="lifetimePrice"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Form.Item
            extra={t('admin.plans.field.featuresHint', '每行一条')}
            label={t('admin.plans.field.features', '权益说明')}
            name="features"
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            label={t('admin.plans.field.purchaseUrl', '购买链接')}
            name="purchaseUrl"
            extra={t(
              'admin.plans.field.purchaseUrlHint',
              '用户在套餐页点击“升级”时会打开该链接，仅支持 http/https。',
            )}
          >
            <Input placeholder="https://..." />
          </Form.Item>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              label={t('admin.plans.field.badge', '套餐徽标')}
              name="badge"
              style={{ flex: 1 }}
            >
              <Input placeholder={t('admin.plans.field.badgePlaceholder', '最受欢迎')} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.yearlyDiscountLabel', '年付优惠文案')}
              name="yearlyDiscountLabel"
              style={{ flex: 1 }}
            >
              <Input placeholder={t('admin.plans.field.yearlyDiscountPlaceholder', '优惠 20%')} />
            </Form.Item>
          </Flexbox>
          <Form.Item
            extra={t('admin.plans.field.comparisonNoteHint', '展示在用户端套餐对比表中。')}
            label={t('admin.plans.field.comparisonNote', '套餐对比说明')}
            name="comparisonNote"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              extra={t('admin.plans.field.storageQuotaHint', '留空表示不限；0 表示禁止上传。')}
              label={t('admin.plans.field.storageQuotaMb', '存储空间上限 MB')}
              name="storageQuotaMb"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.vectorQuota', '向量条数上限')}
              name="vectorQuota"
              style={{ flex: 1 }}
              extra={t(
                'admin.plans.field.vectorQuotaHint',
                '留空表示不限；按 embeddings 记录条数计算。',
              )}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              label={t('admin.plans.field.pptEnabled', '允许 PPT 创作')}
              name="pptEnabled"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              extra={t('admin.plans.field.pptMonthlyQuotaHint', '留空表示不限制。')}
              label={t('admin.plans.field.pptMonthlyQuota', 'PPT 月生成次数')}
              name="pptMonthlyQuota"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.pptCreditCost', '每次成功生成扣除积分')}
              name="pptCreditCost"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12} wrap="wrap">
            <Form.Item
              label={t('admin.plans.field.sortOrder', '排序值')}
              name="sortOrder"
              style={{ flex: 1 }}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('admin.plans.field.active', '启用')}
              name="isActive"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Flexbox>
        </Form>
      </Modal>
    </AdminPageShell>
  );
});

AdminPlansPage.displayName = 'AdminPlansPage';

export default AdminPlansPage;
