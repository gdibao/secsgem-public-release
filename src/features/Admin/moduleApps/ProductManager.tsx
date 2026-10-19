'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, message, Select, Tag } from 'antd';
import { Pencil, Plus, Save } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { moduleAppCacheKeys } from './shared/cacheKeys';
import ModulePageState from './shared/ModulePageState';

type ProductType = 'free' | 'one_time' | 'subscription';
type LicenseScope = 'personal' | 'workspace' | 'workspace_seat';
type ProductStatus = 'active' | 'inactive';

type ProductRow = {
  amount: number;
  billingPeriod?: 'monthly' | 'yearly';
  currency: 'CNY' | 'USD';
  licenseScope: LicenseScope;
  metadata?: Record<string, unknown>;
  productId: string;
  productKey: string;
  productType: ProductType;
  promotion?: Record<string, unknown>;
  status: ProductStatus;
  trialDays?: number;
};

type ProductFormValues = {
  amount: number;
  billingPeriod?: 'monthly' | 'yearly';
  currency: 'CNY' | 'USD';
  licenseScope: LicenseScope;
  moduleMultiplier?: number;
  productKey: string;
  productType: ProductType;
  promotionTitle?: string;
  revenueShareRate?: number;
  seatCount?: number;
  status: ProductStatus;
  termsVersion?: string;
  trialDays?: number;
};

type ProductService = Pick<
  typeof adminCommercialService.moduleApps,
  'createProduct' | 'listProducts' | 'updateProduct'
>;

const initialValues: ProductFormValues = {
  amount: 0,
  currency: 'CNY',
  licenseScope: 'personal',
  moduleMultiplier: 1,
  productKey: '',
  productType: 'one_time',
  revenueShareRate: 0,
  status: 'active',
  termsVersion: '1',
  trialDays: 0,
};

const normalizeOptionalText = (value?: string) => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const normalizeOptionalDecimal = (value?: number) =>
  typeof value === 'number' ? String(value) : undefined;

const ProductManager = memo<{
  appId: string;
  canWrite?: boolean;
  service?: ProductService;
}>(({ appId, canWrite = true, service = adminCommercialService.moduleApps }) => {
  const { t } = useTranslation('common');
  const [form] = Form.useForm<ProductFormValues>();
  const licenseScope = Form.useWatch('licenseScope', form);
  const productType = Form.useWatch('productType', form);
  const [editing, setEditing] = useState<ProductRow>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = useMemo(() => moduleAppCacheKeys.products(appId), [appId]);
  const {
    data = [],
    error,
    isLoading,
    mutate: retry,
  } = useClientDataSWR(key, () => service.listProducts({ appId }) as Promise<ProductRow[]>);

  const close = () => {
    setOpen(false);
    setEditing(undefined);
    form.resetFields();
  };

  const add = () => {
    if (!canWrite) return;

    setEditing(undefined);
    form.setFieldsValue(initialValues);
    setOpen(true);
  };

  const edit = (row: ProductRow) => {
    if (!canWrite) return;

    setEditing(row);
    form.setFieldsValue({
      amount: row.amount,
      billingPeriod: row.billingPeriod,
      currency: row.currency,
      licenseScope: row.licenseScope,
      moduleMultiplier: Number(row.metadata?.moduleMultiplier ?? 1),
      productKey: row.productKey,
      productType: row.productType,
      promotionTitle: typeof row.promotion?.title === 'string' ? row.promotion.title : undefined,
      revenueShareRate: Number(row.metadata?.revenueShareRate ?? 0),
      seatCount: typeof row.metadata?.seatCount === 'number' ? row.metadata.seatCount : undefined,
      status: row.status,
      termsVersion: String(row.metadata?.termsVersion ?? '1'),
      trialDays: row.trialDays ?? 0,
    });
    setOpen(true);
  };

  const save = async (values: ProductFormValues) => {
    if (!canWrite) return;

    setSaving(true);
    const promotionTitle = normalizeOptionalText(values.promotionTitle);
    const price = {
      amount: Number(values.amount),
      ...(values.billingPeriod ? { billingPeriod: values.billingPeriod } : {}),
      currency: values.currency,
      ...(promotionTitle ? { promotion: { title: promotionTitle } } : {}),
      trialDays: values.trialDays ?? 0,
    };
    const moduleMultiplier = normalizeOptionalDecimal(values.moduleMultiplier);
    const revenueShareRate = normalizeOptionalDecimal(values.revenueShareRate);
    const termsVersion = normalizeOptionalText(values.termsVersion);
    try {
      if (editing) {
        await service.updateProduct({
          licenseScope: values.licenseScope,
          moduleMultiplier,
          price,
          productId: editing.productId,
          productType: values.productType,
          revenueShareRate,
          seatCount: values.seatCount,
          status: values.status,
          termsVersion,
        });
      } else {
        await service.createProduct({
          appId,
          licenseScope: values.licenseScope,
          moduleMultiplier,
          price,
          productKey: values.productKey.trim(),
          productType: values.productType,
          revenueShareRate,
          seatCount: values.seatCount,
          termsVersion,
        });
      }
      await mutate(key);
      message.success(
        t(editing ? 'moduleApps.admin.products.updated' : 'moduleApps.admin.products.created'),
      );
      close();
    } catch {
      message.error(t('moduleApps.admin.products.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { dataIndex: 'productKey', title: t('moduleApps.admin.products.productKey') },
    {
      dataIndex: 'productType',
      render: (value: ProductType) =>
        t(
          value === 'one_time'
            ? 'moduleApps.admin.products.type.oneTime'
            : value === 'free'
              ? 'moduleApps.admin.products.type.free'
              : 'moduleApps.admin.products.type.subscription',
        ),
      title: t('moduleApps.admin.products.type'),
    },
    {
      dataIndex: 'licenseScope',
      render: (value: LicenseScope) =>
        t(
          value === 'workspace_seat'
            ? 'moduleApps.admin.products.scope.workspaceSeat'
            : value === 'personal'
              ? 'moduleApps.admin.products.scope.personal'
              : 'moduleApps.admin.products.scope.workspace',
        ),
      title: t('moduleApps.admin.products.scope'),
    },
    {
      render: (_: unknown, row: ProductRow) => `${row.currency} ${row.amount}`,
      title: t('moduleApps.admin.products.activePrice'),
    },
    {
      render: (_: unknown, row: ProductRow) => (
        <Tag color={row.status === 'active' ? 'green' : 'default'}>
          {t(
            row.status === 'active'
              ? 'moduleApps.admin.products.status.active'
              : 'moduleApps.admin.products.status.inactive',
          )}
        </Tag>
      ),
      title: t('moduleApps.admin.products.status'),
    },
    {
      render: (_: unknown, row: ProductRow) => (
        <Button
          disabled={!canWrite}
          icon={<Pencil size={14} />}
          size="small"
          onClick={() => edit(row)}
        >
          {t('moduleApps.admin.products.edit')}
        </Button>
      ),
      title: t('moduleApps.admin.products.actions'),
    },
  ];

  return (
    <Flexbox gap={12}>
      <ModulePageState
        error={error}
        errorDescription={t('moduleApps.admin.products.loadErrorDescription')}
        errorTitle={t('moduleApps.admin.products.loadErrorTitle')}
        isEmpty={!isLoading && !error && data.length === 0}
        loading={isLoading}
        loadingLabel={t('moduleApps.admin.products.loading')}
        onRetry={() => void retry()}
        primaryAction={
          canWrite
            ? {
                icon: <Plus size={16} />,
                label: t('moduleApps.admin.products.add'),
                onClick: add,
              }
            : undefined
        }
        retryLabel={t('moduleApps.admin.products.retry')}
        emptyDescription={t('moduleApps.admin.products.emptyDescription')}
        emptyTitle={t('moduleApps.admin.products.emptyTitle')}
      >
        <Flexbox gap={12}>
          <Flexbox horizontal justify="flex-end">
            <Button disabled={!canWrite} icon={<Plus size={16} />} type="primary" onClick={add}>
              {t('moduleApps.admin.products.add')}
            </Button>
          </Flexbox>
          <InlineTable columns={columns as any} dataSource={data} rowKey="productId" />
        </Flexbox>
      </ModulePageState>
      <Modal
        destroyOnHidden
        footer={null}
        open={open}
        title={t(editing ? 'moduleApps.admin.products.edit' : 'moduleApps.admin.products.add')}
        onCancel={close}
      >
        <Form<ProductFormValues>
          disabled={!canWrite}
          form={form}
          initialValues={initialValues}
          layout="vertical"
          onFinish={save}
        >
          <Form.Item
            label={t('moduleApps.admin.products.productKey')}
            name="productKey"
            rules={[{ required: true }]}
          >
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Flexbox horizontal gap={12}>
            <Form.Item
              label={t('moduleApps.admin.products.type')}
              name="productType"
              style={{ flex: 1 }}
            >
              <Select
                options={[
                  { label: t('moduleApps.admin.products.type.free'), value: 'free' },
                  { label: t('moduleApps.admin.products.type.oneTime'), value: 'one_time' },
                  {
                    label: t('moduleApps.admin.products.type.subscription'),
                    value: 'subscription',
                  },
                ]}
                onChange={(value: ProductType) => {
                  if (value === 'free') form.setFieldValue('amount', 0);
                  if (value !== 'subscription') form.setFieldValue('billingPeriod', undefined);
                }}
              />
            </Form.Item>
            <Form.Item
              label={t('moduleApps.admin.products.scope')}
              name="licenseScope"
              style={{ flex: 1 }}
            >
              <Select
                options={[
                  { label: t('moduleApps.admin.products.scope.personal'), value: 'personal' },
                  { label: t('moduleApps.admin.products.scope.workspace'), value: 'workspace' },
                  {
                    label: t('moduleApps.admin.products.scope.workspaceSeat'),
                    value: 'workspace_seat',
                  },
                ]}
              />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12}>
            <Form.Item
              label={t('moduleApps.admin.products.amount')}
              name="amount"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <InputNumber
                disabled={productType === 'free'}
                min={0}
                precision={0}
                step={1}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item
              label={t('moduleApps.admin.products.currency')}
              name="currency"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select
                options={[
                  { label: 'CNY', value: 'CNY' },
                  { label: 'USD', value: 'USD' },
                ]}
              />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12}>
            <Form.Item
              label={t('moduleApps.admin.products.billingPeriod')}
              name="billingPeriod"
              rules={[{ required: productType === 'subscription' }]}
              style={{ flex: 1 }}
            >
              <Select
                allowClear
                disabled={productType !== 'subscription'}
                options={[
                  { label: t('moduleApps.admin.products.period.monthly'), value: 'monthly' },
                  { label: t('moduleApps.admin.products.period.yearly'), value: 'yearly' },
                ]}
              />
            </Form.Item>
            <Form.Item
              label={t('moduleApps.admin.products.trialDays')}
              name="trialDays"
              style={{ flex: 1 }}
            >
              <InputNumber max={365} min={0} precision={0} step={1} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Form.Item label={t('moduleApps.admin.products.promotionTitle')} name="promotionTitle">
            <Input maxLength={160} />
          </Form.Item>
          <Flexbox horizontal gap={12}>
            <Form.Item
              label={t('moduleApps.admin.products.moduleMultiplier')}
              name="moduleMultiplier"
              style={{ flex: 1 }}
            >
              <InputNumber
                max={100}
                min={0}
                precision={4}
                step={0.0001}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item
              label={t('moduleApps.admin.products.revenueShareRate')}
              name="revenueShareRate"
              style={{ flex: 1 }}
            >
              <InputNumber max={1} min={0} precision={4} step={0.0001} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={12}>
            <Form.Item
              label={t('moduleApps.admin.products.seatCount')}
              name="seatCount"
              rules={[{ required: licenseScope === 'workspace_seat' }]}
              style={{ flex: 1 }}
            >
              <InputNumber max={100_000} min={1} precision={0} step={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t('moduleApps.admin.products.termsVersion')}
              name="termsVersion"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Input maxLength={80} />
            </Form.Item>
          </Flexbox>
          {editing && (
            <Form.Item label={t('moduleApps.admin.products.status')} name="status">
              <Select
                options={[
                  { label: t('moduleApps.admin.products.status.active'), value: 'active' },
                  { label: t('moduleApps.admin.products.status.inactive'), value: 'inactive' },
                ]}
              />
            </Form.Item>
          )}
          <Button
            block
            disabled={!canWrite}
            htmlType="submit"
            icon={<Save size={16} />}
            loading={saving}
            type="primary"
          >
            {t('moduleApps.admin.products.save')}
          </Button>
        </Form>
      </Modal>
    </Flexbox>
  );
});

ProductManager.displayName = 'ProductManager';

export default ProductManager;
