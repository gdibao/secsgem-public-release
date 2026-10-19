'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Modal } from '@lobehub/ui/base-ui';
import { Empty, Form, Input, InputNumber, message, Switch, Tag } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { normalizeTopUpPackagePromotion } from '@/const/billingPresentation';
import {
  formatAdminCredits,
  toAdminAtomicCredits,
  toAdminDisplayCredits,
} from '@/features/Admin/adminCreditUnits';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
} from './layout';

type PackageRow = {
  amount: number;
  credits: number;
  currency: string;
  displayName: string;
  id: string;
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
  recommended: boolean;
  sortOrder: number;
  validityMonths: number;
};

const SWR_KEY = ['admin-topup-packages'];

type AdminTopUpPackagesPageProps = {
  embedded?: boolean;
};

const AdminTopUpPackagesPage = memo<AdminTopUpPackagesPageProps>(({ embedded = false }) => {
  const { t } = useTranslation('subscription');
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(SWR_KEY, () => adminCommercialService.listPackages());
  const [editing, setEditing] = useState<Partial<PackageRow> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const items = (data?.items ?? []) as PackageRow[];

  const openEdit = (row?: PackageRow) => {
    const init = row ?? {
      amount: 0,
      credits: 0,
      currency: 'CNY',
      displayName: '',
      id: '',
      isActive: true,
      recommended: false,
      sortOrder: 0,
      validityMonths: 12,
    };
    const promotion = normalizeTopUpPackagePromotion(init.metadata);
    setEditing(init);
    form.setFieldsValue({
      ...init,
      credits: toAdminDisplayCredits(init.credits),
      originalAmount: promotion.originalAmount,
      promotionEnabled: promotion.enabled,
      promotionLabel: promotion.label,
      promotionNote: promotion.note,
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await adminCommercialService.upsertPackage({
        amount: Number(values.amount || 0),
        credits: toAdminAtomicCredits(values.credits),
        currency: values.currency || 'USD',
        displayName: values.displayName,
        id: values.id,
        isActive: !!values.isActive,
        originalAmount:
          values.originalAmount === null || values.originalAmount === undefined
            ? undefined
            : Number(values.originalAmount),
        promotionEnabled: values.promotionEnabled === true,
        promotionLabel: values.promotionLabel?.trim() || undefined,
        promotionNote: values.promotionNote?.trim() || undefined,
        recommended: !!values.recommended,
        sortOrder: Number(values.sortOrder || 0),
        validityMonths: Number(values.validityMonths || 12),
      });
      message.success(t('admin.topup.saveSuccess', '充值套餐已保存'));
      setEditing(null);
      await mutate(SWR_KEY);
    } catch {
      message.error(t('admin.topup.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    confirmModal({
      content: id,
      onOk: async () => {
        await adminCommercialService.deletePackage(id);
        message.success(t('admin.topup.deleted', '充值套餐已删除'));
        await mutate(SWR_KEY);
      },
      title: t('admin.topup.confirmDelete', '确认删除这个充值套餐？'),
    });
  };

  const handleToggleActive = async (row: PackageRow) => {
    await adminCommercialService.setPackageActive({ id: row.id, isActive: !row.isActive });
    await mutate(SWR_KEY);
  };

  const columns = [
    { dataIndex: 'id', key: 'id', title: t('admin.topup.col.id', 'ID') },
    { dataIndex: 'displayName', key: 'displayName', title: t('admin.topup.col.name', '套餐名称') },
    {
      dataIndex: 'credits',
      key: 'credits',
      render: (value: number) => formatAdminCredits(value),
      title: t('admin.topup.col.credits', '积分'),
    },
    {
      dataIndex: 'amount',
      key: 'amount',
      render: (value: number, row: PackageRow) => `${value} ${row.currency}`,
      title: t('admin.topup.col.amount', '金额'),
    },
    {
      dataIndex: 'metadata',
      key: 'promotion',
      render: (_metadata: PackageRow['metadata'], row: PackageRow) => {
        const promotion = normalizeTopUpPackagePromotion(row.metadata);
        if (!promotion.enabled) return <Tag>未设置</Tag>;

        return (
          <Flexbox horizontal gap={4} wrap="wrap">
            <Tag color="red">{promotion.label || '限时优惠'}</Tag>
            {typeof promotion.originalAmount === 'number' ? (
              <Tag>
                原价 {promotion.originalAmount} {row.currency}
              </Tag>
            ) : null}
            {promotion.note ? <Tag color="blue">{promotion.note}</Tag> : null}
          </Flexbox>
        );
      },
      title: t('admin.topup.col.promotion', '促销'),
    },
    {
      dataIndex: 'validityMonths',
      key: 'validityMonths',
      title: t('admin.topup.col.validity', '有效期（月）'),
    },
    {
      dataIndex: 'recommended',
      key: 'recommended',
      render: (value: boolean) => (value ? <Tag color="gold">推荐</Tag> : '-'),
      title: t('admin.topup.col.recommended', '推荐'),
    },
    {
      dataIndex: 'isActive',
      key: 'isActive',
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
      title: t('admin.topup.col.active', '状态'),
    },
    {
      key: 'actions',
      render: (_: unknown, row: PackageRow) => (
        <Flexbox horizontal gap={8}>
          <Button size="small" onClick={() => openEdit(row)}>
            {t('admin.topup.edit', '编辑')}
          </Button>
          <Button size="small" onClick={() => handleToggleActive(row)}>
            {row.isActive ? t('admin.topup.deactivate', '停用') : t('admin.topup.activate', '启用')}
          </Button>
          <Button danger size="small" onClick={() => handleDelete(row.id)}>
            {t('admin.topup.delete', '删除')}
          </Button>
        </Flexbox>
      ),
      title: t('admin.topup.col.actions', '操作'),
    },
  ];

  const content = (
    <Flexbox gap={24}>
      <AdminToolbar>
        <Button disabled={isLoading || Boolean(error)} type="primary" onClick={() => openEdit()}>
          {t('admin.topup.create', '新增充值套餐')}
        </Button>
      </AdminToolbar>

      {error ? (
        <AdminPageError
          description={t('admin.topup.loadFailed', '充值套餐加载失败，请重试。')}
          onRetry={refresh}
        />
      ) : (
        <AdminSection
          title={t('admin.topup.listTitle', '充值套餐列表')}
          description={t('admin.topup.resultSummary', {
            count: items.length,
            defaultValue: '当前显示 {{count}} 个充值套餐',
          })}
        >
          <AdminResponsiveTable label={t('admin.topup.tableLabel', '充值套餐表格')}>
            {!isLoading && items.length === 0 ? (
              <Empty description={t('admin.topup.empty', '暂无充值套餐')} />
            ) : (
              <InlineTable
                columns={columns as any}
                dataSource={items}
                loading={isLoading}
                rowKey="id"
              />
            )}
          </AdminResponsiveTable>
        </AdminSection>
      )}

      <Modal
        confirmLoading={submitting}
        open={!!editing}
        width={600}
        title={
          editing?.id
            ? t('admin.topup.modal.edit', '编辑充值套餐')
            : t('admin.topup.modal.create', '新增充值套餐')
        }
        onCancel={() => setEditing(null)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label={t('admin.topup.field.id', '套餐 ID（如 starter-100）')}
            name="id"
            rules={[{ required: true }]}
          >
            <Input disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item
            label={t('admin.topup.field.name', '套餐名称')}
            name="displayName"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <AdminFormGrid columns={3} label={t('admin.topup.amountFields', '积分与金额字段')}>
            <Form.Item label={t('admin.topup.field.credits', '积分')} name="credits">
              <InputNumber addonAfter={'M'} min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={t('admin.topup.field.amount', '金额')} name="amount">
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={t('admin.topup.field.currency', '币种')} name="currency">
              <Input />
            </Form.Item>
          </AdminFormGrid>
          <AdminFormGrid label={t('admin.topup.orderFields', '有效期与排序字段')}>
            <Form.Item
              label={t('admin.topup.field.validity', '有效期（月）')}
              name="validityMonths"
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={t('admin.topup.field.sortOrder', '排序值')} name="sortOrder">
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </AdminFormGrid>
          <AdminFormGrid label={t('admin.topup.stateFields', '推荐与启用状态')}>
            <Form.Item
              label={t('admin.topup.field.recommended', '推荐')}
              name="recommended"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t('admin.topup.field.active', '启用')}
              name="isActive"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </AdminFormGrid>
          <AdminFormGrid label={t('admin.topup.promotionFields', '促销状态与原价')}>
            <Form.Item
              label={t('admin.topup.field.promotionEnabled', '启用促销')}
              name="promotionEnabled"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t('admin.topup.field.originalAmount', '促销原价')}
              name="originalAmount"
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </AdminFormGrid>
          <AdminFormGrid label={t('admin.topup.promotionCopyFields', '促销文案字段')}>
            <Form.Item
              label={t('admin.topup.field.promotionLabel', '促销标签')}
              name="promotionLabel"
            >
              <Input placeholder={t('admin.topup.field.promotionLabelPlaceholder', '限时优惠')} />
            </Form.Item>
            <Form.Item
              label={t('admin.topup.field.promotionNote', '促销说明')}
              name="promotionNote"
            >
              <Input
                placeholder={t('admin.topup.field.promotionNotePlaceholder', '有效期 6 个月')}
              />
            </Form.Item>
          </AdminFormGrid>
        </Form>
      </Modal>
    </Flexbox>
  );

  return embedded ? (
    content
  ) : (
    <AdminPageShell
      description={t('admin.topup.subtitle', '维护充值套餐、积分额度、促销和启用状态。')}
      title={t('admin.topup.title', '充值套餐')}
      width="full"
    >
      {content}
    </AdminPageShell>
  );
});

AdminTopUpPackagesPage.displayName = 'AdminTopUpPackagesPage';

export default AdminTopUpPackagesPage;
