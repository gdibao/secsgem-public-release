'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, confirmModal, Drawer, Modal, Select, Tabs } from '@lobehub/ui/base-ui';
import {
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { RefreshCw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAdminModelTypeLabel } from '@/features/Admin/adminModelTypeLabels';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { serverConfigKeys } from '@/libs/swr/keys';
import { adminCommercialService } from '@/services/adminCommercial';
import { useAiInfraStore } from '@/store/aiInfra';

import AdminDangerousActionButton from './AdminDangerousActionButton';
import type { AdminDangerousActionEnvelope } from './adminDangerousActions';
import AdminDependencyImpactPreview from './AdminDependencyImpactPreview';
import {
  ADMIN_MODEL_API_PROVIDER_TYPES,
  type AdminModelApiProviderType,
  buildProviderInstancePayload,
  getDefaultBaseUrlForAdminProviderType,
  resolveProviderPricingPolicyForForm,
} from './adminProviderInstanceForm';
import {
  type AdminModelAbilities,
  AiProviderModelAbilitiesCell,
  buildManualAbilitiesMetadata,
} from './adminProviderModelAbilities';
import {
  AiProviderModelPricingCell,
  buildManualMediaPricingMetadata,
  buildManualTokenPricingMetadata,
} from './adminProviderModelPricing';
import { AdminPageError, AdminPageShell, AdminResponsiveTable, AdminSection } from './layout';

type ModelType =
  'chat' | 'embedding' | 'tts' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

const MODEL_TYPES: ModelType[] = [
  'chat',
  'image',
  'video',
  'embedding',
  'tts',
  'stt',
  'text2music',
  'realtime',
];

interface InstanceRow {
  apiKey: string | null;
  apiKeyStatus?: 'invalid' | 'ok';
  baseUrl: string;
  description: string | null;
  enabled: boolean;
  fetchOnClient: boolean;
  groupKey: string;
  groupMultiplier: number | null;
  groupName: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  priority: number;
  providerType: AdminModelApiProviderType;
  usageScope: ModelType[] | null;
}

interface ModelRow {
  displayName: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown> | null;
  modelId: string;
  modelType: ModelType;
  sortOrder: number;
}

const INSTANCES_KEY = ['admin-provider-instances'];
const modelsKey = (instanceId: string, modelType?: ModelType) =>
  ['admin-provider-instance-models', instanceId, modelType ?? 'all'] as const;

const hasSyncedOrManualPricing = (metadata?: Record<string, unknown> | null) => {
  if (metadata?.pricingAvailable === true) return true;

  const manualPricing =
    metadata?.manualPricing && typeof metadata.manualPricing === 'object'
      ? (metadata.manualPricing as Record<string, unknown>)
      : undefined;

  return Boolean(
    manualPricing &&
    [
      manualPricing.inputCostRate,
      manualPricing.inputRate,
      manualPricing.outputCostRate,
      manualPricing.outputRate,
      manualPricing.imageRate,
      manualPricing.videoRate,
    ].some((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  );
};

const PROVIDER_TYPE_LABELS: Record<AdminModelApiProviderType, string> = {
  'aliyun': '阿里云 DashScope',
  'claude': 'Claude / Anthropic',
  'deepseek': 'DeepSeek',
  'newapi': 'AI 服务商',
  'sub2api': 'Sub2API',
  'openai': 'OpenAI',
  'openai-compatible': '兼容 OpenAI 格式',
  'opencode-go': 'OpenCode Go',
  'siliconflow': 'SiliconFlow',
};

const splitToList = (text: string): string[] =>
  text
    .split(/[\r\n,;；，]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const InstanceFormModal = memo<{
  initial?: InstanceRow | null;
  onClose: () => void;
  open: boolean;
}>(({ initial, onClose, open }) => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!initial;
  const providerType = Form.useWatch('providerType', form) as AdminModelApiProviderType | undefined;
  const providerTypeOptions = useMemo(
    () =>
      ADMIN_MODEL_API_PROVIDER_TYPES.map((type) => ({
        label: PROVIDER_TYPE_LABELS[type],
        value: type,
      })),
    [],
  );
  const usageScopeOptions = useMemo(
    () =>
      MODEL_TYPES.map((type) => ({
        label: t(`admin.providers.modelType.${type}`, getAdminModelTypeLabel(type)),
        value: type,
      })),
    [t],
  );

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = buildProviderInstancePayload(values, { isEdit });
      if (isEdit && initial) {
        await adminCommercialService.updateAiProviderInstance({
          data: payload as any,
          id: initial.id,
        });
      } else {
        await adminCommercialService.createAiProviderInstance(payload as any);
      }
      message.success(t('admin.providers.saveSuccess', '已保存'));
      await mutate(INSTANCES_KEY);
      onClose();
    } catch (e) {
      if ((e as { errorFields?: unknown }).errorFields) return;
      message.error(t('admin.providers.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleProviderTypeChange = (nextProviderType: AdminModelApiProviderType) => {
    const currentBaseUrl = form.getFieldValue('baseUrl');
    const defaultBaseUrl = getDefaultBaseUrlForAdminProviderType(nextProviderType);
    if (!currentBaseUrl && defaultBaseUrl) {
      form.setFieldValue('baseUrl', defaultBaseUrl);
    }
    form.setFieldValue(
      'pricingPolicy',
      resolveProviderPricingPolicyForForm({ newInstance: true, providerType: nextProviderType }),
    );
  };

  return (
    <Modal
      destroyOnHidden
      confirmLoading={submitting}
      open={open}
      width={560}
      afterOpenChange={(visible: boolean) => {
        if (visible) {
          form.setFieldsValue(
            initial
              ? {
                  ...initial,
                  apiKey: initial.apiKeyStatus === 'invalid' ? '' : initial.apiKey,
                  pricingPolicy: resolveProviderPricingPolicyForForm({
                    metadata: initial.metadata,
                    providerType: initial.providerType,
                  }),
                }
              : {
                  apiKey: '',
                  baseUrl: '',
                  description: '',
                  enabled: true,
                  fetchOnClient: false,
                  groupKey: 'default',
                  groupMultiplier: undefined,
                  groupName: '',
                  name: '',
                  pricingPolicy: resolveProviderPricingPolicyForForm({ newInstance: true }),
                  priority: 0,
                  providerType: 'newapi',
                  usageScope: [],
                },
          );
        }
      }}
      title={
        isEdit
          ? t('admin.providers.modal.editInstance', '编辑实例')
          : t('admin.providers.modal.createInstance', '新建实例')
      }
      onCancel={onClose}
      onOk={handleOk}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={t('admin.providers.field.providerType', '服务商类型')}
          name="providerType"
          extra={
            providerType === 'newapi'
              ? t(
                  'admin.providers.field.providerTypeNewapiHint',
                  'AI 服务商网关支持同步模型和价格。',
                )
              : providerType === 'sub2api'
                ? t(
                    'admin.providers.field.providerTypeSub2apiHint',
                    'Sub2API 会从密钥计费信息和模型广场同步可确认的价格。',
                  )
                : t(
                    'admin.providers.field.providerTypeOpenaiHint',
                    'OpenAI 兼容、Claude 和 OpenCode Go 格式支持同步模型；价格需要在计费矩阵中配置。',
                  )
          }
        >
          <Select options={providerTypeOptions} onChange={handleProviderTypeChange} />
        </Form.Item>
        <Flexbox horizontal gap={24} wrap={'wrap'}>
          <Form.Item
            label={t('admin.providers.field.upstreamPricing', '同步上游价格')}
            name={['pricingPolicy', 'upstreamSyncEnabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            label={t('admin.providers.field.lobeHubOfficialPricing', '使用 LobeHub 官方价格')}
            name={['pricingPolicy', 'lobeHubOfficialPricingEnabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            label={t('admin.providers.field.modelBankFallback', '按模型名使用系统价格')}
            name={['pricingPolicy', 'modelBankFallbackEnabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Flexbox>
        <Form.Item
          label={t('admin.providers.field.name', '名称')}
          name="name"
          rules={[
            { message: t('admin.providers.field.nameRequired', '请填写名称'), required: true },
          ]}
        >
          <Input placeholder="Default" />
        </Form.Item>
        <Form.Item
          label={t('admin.providers.field.baseUrl', '基础地址（Base URL）')}
          name="baseUrl"
          rules={[
            {
              message: t('admin.providers.field.baseUrlRequired', '请填写基础地址'),
              required: true,
            },
            { type: 'url' },
          ]}
        >
          <Input placeholder="https://api.example.com" />
        </Form.Item>
        <Form.Item
          label={t('admin.providers.field.apiKey', 'API 密钥（API Key）')}
          name="apiKey"
          rules={isEdit ? [] : [{ required: true }]}
          extra={
            isEdit && initial?.apiKeyStatus === 'invalid'
              ? t(
                  'admin.providers.field.apiKeyInvalidHint',
                  '当前密钥无法解密，请填写新的 API Key 后保存。',
                )
              : isEdit
                ? t(
                    'admin.providers.field.apiKeyEditHint',
                    '留空表示保持现有密钥不变；填写新密钥会替换当前密钥。',
                  )
                : undefined
          }
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Flexbox horizontal gap={12}>
          <Form.Item
            label={t('admin.providers.field.priority', '优先级')}
            name="priority"
            style={{ flex: 1 }}
            extra={t(
              'admin.providers.field.priorityHint',
              '数字越小优先级越高，用于路由和故障切换。',
            )}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t('admin.providers.field.enabled', '启用')}
            name="enabled"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            hidden
            label={t('admin.providers.field.fetchOnClient', '客户端拉取')}
            name="fetchOnClient"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Flexbox>
        <Flexbox horizontal gap={12}>
          <Form.Item
            label={t('admin.providers.field.groupKey', '分组 Key')}
            name="groupKey"
            style={{ flex: 1 }}
            extra={t(
              'admin.providers.field.groupKeyHint',
              '用于套餐授权和分组计费；未区分时使用 default。',
            )}
          >
            <Input placeholder="default / basic / pro" />
          </Form.Item>
          <Form.Item
            label={t('admin.providers.field.groupName', '分组名称')}
            name="groupName"
            style={{ flex: 1 }}
          >
            <Input placeholder="基础分组 / 专业分组" />
          </Form.Item>
          <Form.Item
            label={t('admin.providers.field.groupMultiplier', '分组倍率')}
            name="groupMultiplier"
            style={{ flex: 1 }}
            extra={t(
              'admin.providers.field.groupMultiplierHint',
              '可选，用于记录上游分组成本倍率。',
            )}
          >
            <InputNumber min={0} precision={4} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Flexbox>
        <Form.Item
          label={t('admin.providers.field.usageScope', '用途范围')}
          name="usageScope"
          extra={t(
            'admin.providers.field.usageScopeHint',
            '为空表示不限用途；填写后该实例只承接选中的模型类型。',
          )}
        >
          <Select
            allowClear
            mode="multiple"
            options={usageScopeOptions}
            placeholder={t('admin.providers.field.usageScopePlaceholder', '不限用途')}
          />
        </Form.Item>
        <Form.Item label={t('admin.providers.field.description', '描述')} name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
});
InstanceFormModal.displayName = 'InstanceFormModal';

const ModelTypePanel = memo<{ instanceId: string; modelType: ModelType }>(
  ({ instanceId, modelType }) => {
    const { t } = useTranslation('subscription');
    const refreshAiProviderRuntimeState = useAiInfraStore((s) => s.refreshAiProviderRuntimeState);
    const swrKey = modelsKey(instanceId, modelType);
    const { data, isLoading } = useClientDataSWR(swrKey, () =>
      adminCommercialService.listAiProviderInstanceModels({ instanceId, modelType }),
    );
    const items = (data?.items ?? []) as ModelRow[];

    const [bulkText, setBulkText] = useState('');
    const [adding, setAdding] = useState(false);
    const [batchUpdating, setBatchUpdating] = useState<'disable' | 'enable' | null>(null);

    const refreshModels = async () => {
      await mutate(swrKey);
      await refreshAiProviderRuntimeState();
    };

    const handleBulkAdd = async () => {
      const ids = splitToList(bulkText);
      if (ids.length === 0) return;
      setAdding(true);
      try {
        await adminCommercialService.addAiProviderInstanceModels({
          instanceId,
          models: ids.map((id, i) => ({
            enabled: true,
            modelId: id,
            modelType,
            sortOrder: i,
          })),
        });
        message.success(t('admin.providers.models.addSuccess', '模型已添加'));
        setBulkText('');
        await refreshModels();
      } catch {
        message.error(t('admin.providers.models.addFailed', '添加模型失败'));
      } finally {
        setAdding(false);
      }
    };

    const handleBatchToggle = async (enabled: boolean) => {
      const targetRows = items.filter((item) => item.enabled !== enabled);
      if (targetRows.length === 0) return;

      setBatchUpdating(enabled ? 'enable' : 'disable');
      try {
        await adminCommercialService.setAiProviderInstanceModelsEnabled({
          enabled,
          instanceId,
          models: targetRows.map(({ modelId, modelType }) => ({ modelId, modelType })),
        });
        message.success(
          enabled
            ? t('admin.providers.models.enableAllSuccess', '已启用当前类型模型')
            : t('admin.providers.models.disableAllSuccess', '已禁用当前类型模型'),
        );
        await refreshModels();
      } catch {
        message.error(t('admin.providers.models.batchToggleFailed', '批量更新模型失败'));
      } finally {
        setBatchUpdating(null);
      }
    };

    const handleToggle = async (row: ModelRow) => {
      await adminCommercialService.updateAiProviderInstanceModel({
        data: { enabled: !row.enabled },
        instanceId,
        modelId: row.modelId,
        modelType: row.modelType,
      });
      await refreshModels();
    };

    const handleRename = async (row: ModelRow, displayName: string) => {
      await adminCommercialService.updateAiProviderInstanceModel({
        data: { displayName: displayName || undefined },
        instanceId,
        modelId: row.modelId,
        modelType: row.modelType,
      });
      await refreshModels();
    };

    const handleUpdateTokenPricing = async (
      row: ModelRow,
      inputCostRate?: number,
      outputCostRate?: number,
    ) => {
      const metadata =
        row.modelType === 'image' || row.modelType === 'video'
          ? buildManualMediaPricingMetadata({
              imageRate: row.modelType === 'image' ? inputCostRate : undefined,
              metadata: row.metadata,
              videoRate: row.modelType === 'video' ? outputCostRate : undefined,
            })
          : buildManualTokenPricingMetadata({
              inputCostRate,
              metadata: row.metadata,
              outputCostRate,
            });

      await adminCommercialService.updateAiProviderInstanceModel({
        data: { metadata },
        instanceId,
        modelId: row.modelId,
        modelType: row.modelType,
      });
      await refreshModels();
    };

    const handleUpdateAbilities = async (row: ModelRow, abilities: AdminModelAbilities) => {
      await adminCommercialService.updateAiProviderInstanceModel({
        data: {
          metadata: buildManualAbilitiesMetadata({
            abilities,
            metadata: row.metadata,
          }),
        },
        instanceId,
        modelId: row.modelId,
        modelType: row.modelType,
      });
      await refreshModels();
    };

    const handleDelete = async (row: ModelRow) => {
      const target = {
        instanceId,
        modelId: row.modelId,
        modelType: row.modelType,
      };
      const impact = await adminCommercialService.getAiProviderModelDeleteImpact(target);

      confirmModal({
        content: <AdminDependencyImpactPreview impact={impact} />,
        okButtonProps: { danger: true, disabled: !impact.canProceed },
        okText: t('admin.providers.models.confirmRemove', '移除'),
        title: t('admin.providers.models.confirmRemoveTitle', '移除这个模型？'),
        onOk: async () => {
          await adminCommercialService.removeAiProviderInstanceModel(target);
          await refreshModels();
        },
      });
    };

    const columns = [
      {
        dataIndex: 'modelId',
        key: 'modelId',
        title: t('admin.providers.models.col.id', '模型 ID'),
      },
      {
        dataIndex: 'displayName',
        key: 'displayName',
        render: (v: string | null, r: ModelRow) => (
          <Input
            defaultValue={v ?? ''}
            placeholder={r.modelId}
            size="small"
            onBlur={(e: { target: { value: string } }) => {
              const next = e.target.value.trim();
              if ((v ?? '') !== next) handleRename(r, next);
            }}
          />
        ),
        title: t('admin.providers.models.col.displayName', '显示名称'),
        width: 220,
      },
      {
        key: 'pricing',
        render: (_: unknown, r: ModelRow) => (
          <Flexbox gap={6}>
            {!hasSyncedOrManualPricing(r.metadata) ? (
              <Tag color="orange">{t('admin.providers.models.pricing.missing', '未设置价格')}</Tag>
            ) : null}
            <AiProviderModelPricingCell
              metadata={r.metadata}
              modelType={r.modelType}
              t={t}
              onSave={(inputCostRate, outputCostRate) =>
                handleUpdateTokenPricing(r, inputCostRate, outputCostRate)
              }
            />
          </Flexbox>
        ),
        title: t('admin.providers.models.col.pricing', '成本价'),
        width: 280,
      },
      {
        key: 'abilities',
        render: (_: unknown, r: ModelRow) => (
          <AiProviderModelAbilitiesCell
            metadata={r.metadata}
            t={t}
            onSave={(abilities) => handleUpdateAbilities(r, abilities)}
          />
        ),
        title: t('admin.providers.models.col.abilities', '能力'),
        width: 360,
      },
      {
        dataIndex: 'enabled',
        key: 'enabled',
        render: (v: boolean, r: ModelRow) => (
          <Switch checked={v} size="small" onChange={() => handleToggle(r)} />
        ),
        title: t('admin.providers.models.col.enabled', '启用'),
        width: 100,
      },
      {
        key: 'actions',
        render: (_: unknown, r: ModelRow) => (
          <Button danger size="small" type="link" onClick={() => handleDelete(r)}>
            {t('admin.providers.models.remove', '移除')}
          </Button>
        ),
        title: t('admin.providers.models.col.actions', '操作'),
        width: 100,
      },
    ];

    return (
      <Flexbox gap={12}>
        <Flexbox gap={8}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {t('admin.providers.models.bulkAddHint', '可批量添加模型 ID，使用换行或逗号分隔。')}
          </div>
          <Input.TextArea
            placeholder={'gpt-4o-mini\ngpt-4o'}
            rows={3}
            value={bulkText}
            onChange={(e: { target: { value: string } }) => setBulkText(e.target.value)}
          />
          <Flexbox horizontal>
            <Button
              disabled={!bulkText.trim()}
              loading={adding}
              type="primary"
              onClick={handleBulkAdd}
            >
              {t('admin.providers.models.add', '添加模型')}
            </Button>
          </Flexbox>
        </Flexbox>
        {!isLoading && items.length === 0 ? (
          <Empty description={t('admin.providers.models.empty', '该类型暂无模型')} />
        ) : (
          <Flexbox gap={8}>
            <Flexbox horizontal gap={8} justify="flex-end">
              <Button
                disabled={!items.some((item) => !item.enabled)}
                loading={batchUpdating === 'enable'}
                size="small"
                onClick={() => handleBatchToggle(true)}
              >
                {t('admin.providers.models.enableAll', '启用当前类型')}
              </Button>
              <Button
                disabled={!items.some((item) => item.enabled)}
                loading={batchUpdating === 'disable'}
                size="small"
                onClick={() => handleBatchToggle(false)}
              >
                {t('admin.providers.models.disableAll', '禁用当前类型')}
              </Button>
            </Flexbox>
            <Table
              columns={columns as any}
              dataSource={items}
              loading={isLoading}
              pagination={false}
              rowKey={(r: ModelRow) => `${r.modelId}__${r.modelType}`}
              size="small"
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);
ModelTypePanel.displayName = 'ModelTypePanel';

const ModelsDrawer = memo<{ instance: InstanceRow | null; onClose: () => void }>(
  ({ instance, onClose }) => {
    const { t } = useTranslation('subscription');
    const [activeTab, setActiveTab] = useState<ModelType>('chat');

    const tabs = useMemo(
      () =>
        MODEL_TYPES.map((type) => ({
          children: instance ? <ModelTypePanel instanceId={instance.id} modelType={type} /> : null,
          key: type,
          label: t(`admin.providers.modelType.${type}`, getAdminModelTypeLabel(type)),
        })),
      [instance, t],
    );

    return (
      <Drawer
        open={!!instance}
        width={980}
        title={
          instance
            ? t('admin.providers.drawer.title', '{{name}} 的模型', { name: instance.name })
            : ''
        }
        onClose={onClose}
      >
        <Tabs
          activeKey={activeTab}
          items={tabs}
          onChange={(k: string) => setActiveTab(k as ModelType)}
        />
      </Drawer>
    );
  },
);
ModelsDrawer.displayName = 'ModelsDrawer';

const AdminProvidersPage = memo(() => {
  const { t } = useTranslation('subscription');
  const refreshAiProviderRuntimeState = useAiInfraStore((s) => s.refreshAiProviderRuntimeState);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(INSTANCES_KEY, () => adminCommercialService.listAiProviderInstances());

  const [editing, setEditing] = useState<InstanceRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [modelsTarget, setModelsTarget] = useState<InstanceRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [refreshingRuntimeCache, setRefreshingRuntimeCache] = useState(false);

  const items = (data?.items ?? []) as InstanceRow[];

  const handleToggle = async (row: InstanceRow) => {
    await adminCommercialService.toggleAiProviderInstance({ enabled: !row.enabled, id: row.id });
    await mutate(INSTANCES_KEY);
  };

  const handleDelete = async (
    row: InstanceRow,
    command: AdminDangerousActionEnvelope<'newapiProvider.deleteInstance'>,
  ) => {
    await adminCommercialService.deleteAiProviderInstance(
      { id: row.id, reason: command.reason?.trim() },
      command,
    );
    message.success(t('admin.providers.deleteSuccess', '实例已删除'));
    await mutate(INSTANCES_KEY);
  };

  const handleTestConnection = async (row: InstanceRow) => {
    setTestingId(row.id);
    try {
      const result = await adminCommercialService.testAiProviderInstanceConnection(row.id);
      if (result.ok) {
        message.success(
          t(
            'admin.providers.test.success',
            '连接成功：模型 {{modelsCount}} 个，价格 {{pricingCount}} 条',
            {
              modelsCount: result.modelsCount,
              pricingCount: result.pricingCount,
            },
          ),
        );
      } else {
        message.error(
          t('admin.providers.test.failed', '连接失败：{{error}}', {
            error: result.error || t('admin.providers.test.unknownError', '未知错误'),
          }),
        );
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncModels = async (row: InstanceRow) => {
    setSyncingId(row.id);
    try {
      const result = await adminCommercialService.syncAiProviderInstanceModels(row.id);
      message.success(
        t(
          'admin.providers.sync.success',
          '同步完成：删除 {{deletedCount}} 个旧模型，导入 {{count}} 个新模型；同步价格 {{pricingCount}} 条，能力信息覆盖 {{abilitiesCount}} 个模型。新模型默认未启用。',
          {
            abilitiesCount: result.abilitiesCount,
            count: result.importedCount,
            deletedCount: result.deletedCount,
            pricingCount: result.pricingCount,
          },
        ),
      );
      await Promise.all(MODEL_TYPES.map((type) => mutate(modelsKey(row.id, type))));
      await refreshAiProviderRuntimeState();
    } catch (error) {
      message.error(
        t('admin.providers.sync.failed', '同步失败：{{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSyncingId(null);
    }
  };

  const handleRefreshRuntimeCache = async () => {
    if (!data) return;

    setRefreshingRuntimeCache(true);
    try {
      const result = await adminCommercialService.refreshAiProviderRuntimeCache();
      await mutate(serverConfigKeys.get);
      await Promise.all([refreshAiProviderRuntimeState(), mutate(INSTANCES_KEY)]);
      message.success(
        t('admin.providers.refreshRuntimeCache.success', '用户模型缓存已更新：{{time}}', {
          time: new Date(result.refreshedAt).toLocaleString(),
        }),
      );
    } catch (error) {
      message.error(
        t('admin.providers.refreshRuntimeCache.failed', '更新用户缓存失败：{{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setRefreshingRuntimeCache(false);
    }
  };

  const columns = [
    {
      dataIndex: 'name',
      key: 'name',
      title: t('admin.providers.col.name', '名称'),
    },
    {
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      render: (v: string) => (
        <Tooltip title={v}>
          <code style={{ fontSize: 12 }}>{v}</code>
        </Tooltip>
      ),
      title: t('admin.providers.col.baseUrl', '基础地址'),
    },
    {
      dataIndex: 'providerType',
      key: 'providerType',
      render: (value: AdminModelApiProviderType | null) => (
        <Tag color={value === 'newapi' ? 'green' : 'blue'}>
          {PROVIDER_TYPE_LABELS[value || 'newapi']}
        </Tag>
      ),
      title: t('admin.providers.col.providerType', '服务商'),
      width: 150,
    },
    {
      dataIndex: 'apiKey',
      key: 'apiKey',
      render: (v: string | null, row: InstanceRow) =>
        row.apiKeyStatus === 'invalid' ? (
          <Tag color="red">{t('admin.providers.col.apiKeyInvalid', '密钥无效，需重置')}</Tag>
        ) : (
          <code style={{ fontSize: 12 }}>{v ?? '-'}</code>
        ),
      title: t('admin.providers.col.apiKey', 'API 密钥'),
      width: 160,
    },
    {
      dataIndex: 'priority',
      key: 'priority',
      title: t('admin.providers.col.priority', '优先级'),
      width: 90,
    },
    {
      key: 'group',
      render: (_: unknown, row: InstanceRow) => (
        <Flexbox gap={4}>
          <Tag color="purple">{row.groupKey || 'default'}</Tag>
          {row.groupName ? <span style={{ fontSize: 12 }}>{row.groupName}</span> : null}
          {row.groupMultiplier ? (
            <span style={{ fontSize: 12, opacity: 0.7 }}>x{row.groupMultiplier}</span>
          ) : null}
        </Flexbox>
      ),
      title: t('admin.providers.col.group', '分组'),
      width: 160,
    },
    {
      dataIndex: 'usageScope',
      key: 'usageScope',
      render: (value: ModelType[] | null) =>
        value?.length ? (
          <Flexbox horizontal gap={4} wrap="wrap">
            {value.map((type) => (
              <Tag key={type}>
                {t(`admin.providers.modelType.${type}`, getAdminModelTypeLabel(type))}
              </Tag>
            ))}
          </Flexbox>
        ) : (
          <Tag color="default">{t('admin.providers.col.usageScopeAll', '不限')}</Tag>
        ),
      title: t('admin.providers.col.usageScope', '用途'),
      width: 220,
    },
    {
      dataIndex: 'enabled',
      key: 'enabled',
      render: (v: boolean, r: InstanceRow) => (
        <Switch checked={v} size="small" onChange={() => handleToggle(r)} />
      ),
      title: t('admin.providers.col.enabled', '启用'),
      width: 90,
    },
    {
      dataIndex: 'fetchOnClient',
      hidden: true,
      key: 'fetchOnClient',
      render: (v: boolean) =>
        v ? <Tag color="blue">客户端（Client）</Tag> : <Tag color="default">服务端（Server）</Tag>,
      title: t('admin.providers.col.fetchMode', '拉取方式'),
      width: 140,
    },
    {
      key: 'actions',
      render: (_: unknown, row: InstanceRow) => (
        <Flexbox horizontal gap={8}>
          <Button
            loading={testingId === row.id}
            size="small"
            onClick={() => handleTestConnection(row)}
          >
            {t('admin.providers.action.test', '测试')}
          </Button>
          <Popconfirm
            okText={t('admin.providers.action.sync', '同步')}
            title={t(
              'admin.providers.sync.confirm',
              '同步将删除该实例的全部现有模型、启用状态及手工价格/能力设置，并用最新上游模型、价格和能力重新创建。是否继续？',
            )}
            onConfirm={() => handleSyncModels(row)}
          >
            <Button loading={syncingId === row.id} size="small">
              {t('admin.providers.action.sync', '同步')}
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setModelsTarget(row)}>
            {t('admin.providers.action.models', '模型')}
          </Button>
          <Button size="small" onClick={() => setEditing(row)}>
            {t('admin.providers.action.edit', '编辑')}
          </Button>
          <AdminDangerousActionButton
            danger
            actionId="newapiProvider.deleteInstance"
            confirmDescription={t('admin.providers.confirmDelete', '删除这个实例及其全部模型？')}
            loadPreflight={() => adminCommercialService.getAiProviderInstanceDeleteImpact(row.id)}
            size="small"
            onConfirm={(command) => handleDelete(row, command)}
          >
            {t('admin.providers.action.delete', '删除')}
          </AdminDangerousActionButton>
        </Flexbox>
      ),
      title: t('admin.providers.col.actions', '操作'),
      width: 240,
    },
  ];

  return (
    <AdminPageShell
      title={t('admin.providers.title', '服务商管理')}
      width="full"
      actions={
        <>
          <Button
            disabled={isLoading || !data || refreshingRuntimeCache}
            icon={<Icon icon={RefreshCw} size={14} />}
            loading={refreshingRuntimeCache}
            onClick={handleRefreshRuntimeCache}
          >
            {t('admin.providers.refreshRuntimeCache.action', '更新用户缓存')}
          </Button>
          <Button disabled={isLoading || !data} type="primary" onClick={() => setCreating(true)}>
            {t('admin.providers.createInstance', '新建实例')}
          </Button>
        </>
      }
      description={t(
        'admin.providers.intro',
        '配置多个服务商上游实例，并按模型类型登记可用模型。运行时会优先使用匹配模型且优先级最高的实例，失败时按优先级切换到下一个实例。',
      )}
    >
      {error ? (
        <AdminPageError
          description={t('admin.providers.loadFailed', '无法读取服务商实例，请重试。')}
          onRetry={refresh}
        />
      ) : null}

      <AdminSection
        title={t('admin.providers.instanceSection', '服务商实例')}
        description={t('admin.providers.instanceSummary', '共 {{count}} 个服务商实例', {
          count: items.length,
        })}
      >
        {!isLoading && items.length === 0 ? (
          <Empty description={t('admin.providers.empty', '暂未配置服务商实例')} />
        ) : (
          <AdminResponsiveTable label={t('admin.providers.tableLabel', '服务商实例表格')}>
            <Table
              columns={columns as any}
              dataSource={items}
              loading={isLoading}
              pagination={false}
              rowKey="id"
            />
          </AdminResponsiveTable>
        )}
      </AdminSection>

      <InstanceFormModal open={creating} onClose={() => setCreating(false)} />
      <InstanceFormModal initial={editing} open={!!editing} onClose={() => setEditing(null)} />
      <ModelsDrawer instance={modelsTarget} onClose={() => setModelsTarget(null)} />
    </AdminPageShell>
  );
});

AdminProvidersPage.displayName = 'AdminProvidersPage';

export default AdminProvidersPage;
