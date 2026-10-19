'use client';

import { DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';
import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import {
  Alert,
  Empty,
  InputNumber,
  message,
  Space,
  Switch,
  Table,
  type TableColumnsType,
  Tag,
  Typography,
} from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import {
  MATRIX_ACCESS_SAVE_LABEL,
  MATRIX_DISCARD_LABEL,
  MATRIX_NOTICE,
  MATRIX_PRICING_SAVE_LABEL,
  MATRIX_SUBTITLE,
} from '@/features/Admin/adminMatrixCopy';
import {
  type BillingBasisValues,
  buildBillingBasisUpdates,
  buildBillingBasisValues,
  buildMatrixRows,
  buildPlanModelRulesFromRows,
  buildPricingRulesFromRows,
  findFreePlanDefaultModelConflict,
  getDefaultModelHealth,
  getMatrixConfigHealth,
  getMatrixConfigHealthFocus,
  getPlanModelRulesSaveErrorMessage,
  type MatrixConfigHealthCheck,
  type MatrixModelType,
  type MatrixPlan,
  type MatrixPlanRules,
  type MatrixPricingSource,
  type MatrixProviderPricingSource,
  type MatrixRow,
  type MatrixSourceModel,
  togglePlanAccess,
} from '@/features/Admin/adminModelBillingMatrix';
import { getAdminModelTypeLabel } from '@/features/Admin/adminModelTypeLabels';
import { getAdminSettingsRefreshKeys, SETTING_KEYS } from '@/features/Admin/adminSettingsForm';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  AdminFormActions,
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
} from './layout';

const { Text } = Typography;

const MATRIX_KEY = ['admin-model-billing-matrix'];
const PLANS_KEY = ['admin-plans'];

const DEFAULT_HEALTH_STATUS = {
  denied_by_free_plan: { color: 'orange', label: '免费套餐未开放' },
  not_configured: { color: 'default', label: '未配置' },
  not_enabled: { color: 'red', label: '未启用' },
  ok: { color: 'green', label: '正常' },
  type_mismatch: { color: 'red', label: '类型不匹配' },
} as const;

const CONFIG_HEALTH_STATUS = {
  error: { alertType: 'error', color: 'red', label: 'Error' },
  ok: { alertType: 'success', color: 'green', label: 'OK' },
  warning: { alertType: 'warning', color: 'orange', label: 'Warning' },
} as const;

const CONFIG_HEALTH_CHECK_STATUS = {
  error: { color: 'red', label: 'Error' },
  info: { color: 'blue', label: 'Info' },
  ok: { color: 'green', label: 'OK' },
  warning: { color: 'orange', label: 'Warning' },
} as const;

const PRICING_SOURCE_STATUS: Record<MatrixPricingSource, { color: string; label: string }> = {
  'database': { color: 'green', label: 'DB pricing' },
  'lobehub-official': { color: 'cyan', label: 'LobeHub Official' },
  'manual-override': { color: 'gold', label: 'Manual pricing' },
  'missing': { color: 'red', label: 'Missing pricing' },
  'model-bank': { color: 'blue', label: 'Model Bank' },
};

type PlanItem = {
  displayName?: string | null;
  modelRules?: MatrixPlanRules | null;
  plan: string;
};

type EnabledModelItem = {
  displayName?: string | null;
  groupKey?: string | null;
  groupName?: string | null;
  hasModelAbilities?: boolean | null;
  hasModelPricing?: boolean | null;
  instanceId: string;
  instanceName: string;
  modelId: string;
  modelType: MatrixModelType;
  pricingSource?: MatrixProviderPricingSource | null;
  priority: number;
  providerType?: string | null;
};

const FILTERABLE_CONFIG_HEALTH_CHECKS = new Set([
  'blocked-models',
  'default-models',
  'global-pricing-multiplier',
  'healthy',
  'missing-model-abilities',
  'missing-model-pricing',
  'plans-without-models',
  'pricing-fallbacks',
]);

const toFiniteNumber = (value: number | string | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getDefaultModelErrorMessage = (error: any) => {
  if (error?.message === 'DEFAULT_MODEL_NOT_ENABLED') {
    return '默认模型未在已启用模型目录中，请先在服务商实例中启用该模型。';
  }

  if (error?.message === 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN') {
    return '默认模型未被免费套餐允许，新注册用户将无法使用该模型。请调整免费套餐模型权限。';
  }

  return '保存默认模型失败';
};

const AdminModelBillingMatrixPage = memo(() => {
  const { t } = useTranslation('subscription');
  const role = useUserStore((state) => (userProfileSelectors.userProfile(state) as any)?.role);
  const canReadModels =
    hasAdminCapability(role, ADMIN_CAPABILITIES.modelOpsRead) ||
    hasAdminCapability(role, ADMIN_CAPABILITIES.financeRead) ||
    hasAdminCapability(role, ADMIN_CAPABILITIES.systemRead);
  const canReadPlans = hasAdminCapability(role, ADMIN_CAPABILITIES.financeRead);
  const canReadSettings = hasAdminCapability(role, ADMIN_CAPABILITIES.systemRead);
  const canWriteFinance = hasAdminCapability(role, ADMIN_CAPABILITIES.financeWrite);
  const canWriteSystem = hasAdminCapability(role, ADMIN_CAPABILITIES.systemWrite);
  const [billingBasisOverride, setBillingBasisOverride] = useState<BillingBasisValues | null>(null);
  const [focusedHealthCheckKey, setFocusedHealthCheckKey] = useState<string | null>(null);
  const [savingBillingBasis, setSavingBillingBasis] = useState(false);
  const [rowsOverride, setRowsOverride] = useState<MatrixRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    data: modelData,
    error: modelError,
    isLoading: modelsLoading,
  } = useClientDataSWR(canReadModels ? MATRIX_KEY : null, () =>
    adminCommercialService.listAllEnabledAiProviderModels(),
  );
  const {
    data: planData,
    error: planError,
    isLoading: plansLoading,
  } = useClientDataSWR(canReadPlans ? PLANS_KEY : null, () => adminCommercialService.listPlans());
  const {
    data: settings,
    error: settingsError,
    isLoading: settingsLoading,
  } = useClientDataSWR(
    canReadSettings ? ADMIN_SETTINGS_SECTION_SWR_KEY('model-billing-matrix') : null,
    () => adminCommercialService.getSettingsSection('model-billing-matrix'),
  );

  const plans = useMemo<MatrixPlan[]>(
    () =>
      ((planData?.items ?? []) as PlanItem[]).map((plan) => ({
        displayName: plan.displayName || plan.plan,
        plan: plan.plan,
      })),
    [planData?.items],
  );

  const sourceModels = useMemo<MatrixSourceModel[]>(
    () =>
      ((modelData?.items ?? []) as EnabledModelItem[]).map((item) => ({
        displayName: item.displayName ?? null,
        groupKey: item.groupKey,
        groupName: item.groupName,
        hasModelAbilities: item.hasModelAbilities === true,
        hasModelPricing: item.hasModelPricing === true,
        instanceId: item.instanceId,
        instanceName: item.instanceName,
        modelId: item.modelId,
        modelType: item.modelType,
        pricingSource: item.pricingSource ?? undefined,
        priority: item.priority,
        providerType: item.providerType,
      })),
    [modelData?.items],
  );

  const baseRows = useMemo(
    () =>
      buildMatrixRows({
        defaultModel: settings?.defaultAgentModel,
        defaultModelsByType: {
          image: {
            model: settings?.defaultImageModel,
            provider: settings?.defaultImageProvider,
          },
          video: {
            model: settings?.defaultVideoModel,
            provider: settings?.defaultVideoProvider,
          },
        },
        defaultProvider: settings?.defaultAgentProvider,
        models: sourceModels,
        planRulesByPlan: Object.fromEntries(
          ((planData?.items ?? []) as PlanItem[]).map((plan) => [plan.plan, plan.modelRules]),
        ),
        plans,
        pricingRules: settings?.pricingModelRules ?? [],
      }),
    [planData?.items, plans, settings, sourceModels],
  );

  const rows = rowsOverride ?? baseRows;
  const loading =
    (canReadModels && modelsLoading) ||
    (canReadPlans && plansLoading) ||
    (canReadSettings && settingsLoading);
  const hasLoadError =
    (canReadModels && Boolean(modelError)) ||
    (canReadPlans && Boolean(planError)) ||
    (canReadSettings && Boolean(settingsError));
  const refreshMatrixData = () =>
    Promise.all([
      ...(canReadModels ? [mutate(MATRIX_KEY)] : []),
      ...(canReadPlans ? [mutate(PLANS_KEY)] : []),
      ...(canReadSettings ? [mutate(ADMIN_SETTINGS_SECTION_SWR_KEY('model-billing-matrix'))] : []),
    ]);
  const billingBasisInitial = useMemo(() => buildBillingBasisValues(settings), [settings]);
  const billingBasis = billingBasisOverride ?? billingBasisInitial;
  const defaultModelHealth = useMemo(
    () =>
      getDefaultModelHealth(rows, {
        chat: {
          model: settings?.defaultAgentModel,
          provider: settings?.defaultAgentProvider,
        },
        image: {
          model: settings?.defaultImageModel,
          provider: settings?.defaultImageProvider,
        },
        video: {
          model: settings?.defaultVideoModel,
          provider: settings?.defaultVideoProvider,
        },
      }),
    [rows, settings],
  );
  const hasDefaultModelRisk = Object.values(defaultModelHealth).some(
    (item) => item.status !== 'ok',
  );
  const configHealth = useMemo(
    () =>
      getMatrixConfigHealth({
        defaultModelHealth,
        globalPricingMultiplier: billingBasis.pricingMultiplier,
        plans,
        rows,
      }),
    [billingBasis.pricingMultiplier, defaultModelHealth, plans, rows],
  );
  const configHealthMeta = CONFIG_HEALTH_STATUS[configHealth.status];
  const focusedHealthCheck = configHealth.checks.find(
    (check) => check.key === focusedHealthCheckKey,
  );
  const focusedHealthCheckFocus = useMemo(
    () =>
      focusedHealthCheck
        ? getMatrixConfigHealthFocus({
            checkKey: focusedHealthCheck.key,
            defaultModelHealth,
            plans,
            rows,
          })
        : null,
    [defaultModelHealth, focusedHealthCheck, plans, rows],
  );
  const focusedRowKeySet = useMemo(
    () => new Set(focusedHealthCheckFocus?.rowKeys ?? []),
    [focusedHealthCheckFocus?.rowKeys],
  );
  const focusedPlanKeySet = useMemo(
    () => new Set(focusedHealthCheckFocus?.planKeys ?? []),
    [focusedHealthCheckFocus?.planKeys],
  );
  const displayRows = focusedHealthCheck
    ? rows.filter((row) => focusedRowKeySet.has(row.key))
    : rows;
  const canFocusConfigHealthCheck = (check: MatrixConfigHealthCheck) =>
    FILTERABLE_CONFIG_HEALTH_CHECKS.has(check.key);
  const handleFocusConfigHealthCheck = (check: MatrixConfigHealthCheck) => {
    if (!canFocusConfigHealthCheck(check)) return;

    setFocusedHealthCheckKey((current) => (current === check.key ? null : check.key));
  };

  const getDefaultModelHealthMessage = (health: (typeof defaultModelHealth)['chat']) => {
    if (health.status === 'ok') return '已启用，且免费套餐可用，新注册用户可直接使用。';
    if (health.status === 'not_configured') return '后台还没有设置该类型的默认模型。';
    if (health.status === 'not_enabled')
      return '该模型不在已启用模型目录中，请先启用对应服务商模型。';
    if (health.status === 'type_mismatch') {
      return `模型存在，但类型是 ${getAdminModelTypeLabel(health.actualModelType || health.modelType)}，请重新选择 ${getAdminModelTypeLabel(health.modelType)} 模型。`;
    }

    return '该模型已启用，但免费套餐未开放，新注册用户默认不可用。';
  };

  const updateRow = (rowKey: string, patch: Partial<MatrixRow>) => {
    setRowsOverride((current) =>
      (current ?? baseRows).map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    );
  };

  const updateBillingBasis = (patch: Partial<BillingBasisValues>) => {
    setBillingBasisOverride((current) => ({
      ...billingBasisInitial,
      ...current,
      ...patch,
    }));
  };

  const handleSaveBillingBasis = async () => {
    if (!canWriteSystem || !settings) return;

    const updates = buildBillingBasisUpdates(billingBasis, billingBasisInitial);

    if (updates.length === 0) {
      message.info(t('admin.modelBillingMatrix.billingBasisNoChanges', '没有需要保存的变更'));
      return;
    }

    setSavingBillingBasis(true);

    try {
      await adminCommercialService.setAppSettingsBatch({ updates });
      setBillingBasisOverride(null);
      message.success(t('admin.modelBillingMatrix.billingBasisSaved', '全局计费设置已保存'));
    } catch {
      message.error(t('admin.modelBillingMatrix.billingBasisSaveFailed', '保存全局计费设置失败'));
    } finally {
      setSavingBillingBasis(false);
    }
  };

  const handleSetDefault = async (target: MatrixRow) => {
    if (!canWriteSystem || !modelData || !settings) return;

    if (['chat', 'image', 'video'].includes(target.modelType) && target.planAccess.free === false) {
      message.error('该模型未对免费套餐开启，不能设为默认模型。请先开启免费套餐权限。');
      return;
    }

    setSaving(true);

    try {
      const updates =
        target.modelType === 'image'
          ? [
              { key: SETTING_KEYS.defaultImageProvider, value: target.provider },
              { key: SETTING_KEYS.defaultImageModel, value: target.modelId },
            ]
          : target.modelType === 'video'
            ? [
                { key: SETTING_KEYS.defaultVideoProvider, value: target.provider },
                { key: SETTING_KEYS.defaultVideoModel, value: target.modelId },
              ]
            : [
                { key: SETTING_KEYS.defaultAgentProvider, value: target.provider },
                { key: SETTING_KEYS.defaultAgentModel, value: target.modelId },
              ];

      await adminCommercialService.validateDefaultAgentSettings({
        model: target.modelId,
        modelType:
          target.modelType === 'image' || target.modelType === 'video' ? target.modelType : 'chat',
        provider: target.provider,
      });
      await adminCommercialService.setAppSettingsBatch({ updates });
      await Promise.all(getAdminSettingsRefreshKeys(updates).map((key) => mutate(key)));
      setRowsOverride((current) =>
        (current ?? baseRows).map((row) => ({
          ...row,
          isDefault: row.modelType === target.modelType ? row.key === target.key : row.isDefault,
        })),
      );
      message.success(t('admin.modelBillingMatrix.defaultSaved', '默认模型已保存'));
    } catch (error: any) {
      message.error(
        t('admin.modelBillingMatrix.defaultSaveFailed', getDefaultModelErrorMessage(error)),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccess = async () => {
    if (!canWriteFinance || !planData) return;

    const conflict = findFreePlanDefaultModelConflict(rows);
    if (conflict) {
      message.error(
        `默认模型 ${conflict.displayName}（${conflict.provider}/${conflict.modelId}）已被免费套餐关闭，新注册用户将无法使用。请先开启免费套餐权限或更换默认模型。`,
      );
      return;
    }

    setSaving(true);

    try {
      const rulesByPlan = buildPlanModelRulesFromRows(rows, plans);
      await adminCommercialService.setPlanModelRulesBatch(
        Object.entries(rulesByPlan).map(([plan, modelRules]) => ({ modelRules, plan })),
      );
      await mutate(PLANS_KEY);
      message.success(t('admin.modelBillingMatrix.accessSaved', '套餐模型权限已保存'));
    } catch (error) {
      message.error(
        t('admin.modelBillingMatrix.accessSaveFailed', getPlanModelRulesSaveErrorMessage(error)),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSavePricing = async () => {
    if (!canWriteSystem || !settings) return;

    setSaving(true);

    try {
      await adminCommercialService.setAppSetting({
        key: SETTING_KEYS.pricingModelRules,
        value: buildPricingRulesFromRows(rows),
      });
      message.success(t('admin.modelBillingMatrix.pricingSaved', '模型计费已保存'));
    } catch {
      message.error(t('admin.modelBillingMatrix.pricingSaveFailed', '保存模型计费失败'));
    } finally {
      setSaving(false);
    }
  };

  const planColumns: TableColumnsType<MatrixRow> = plans.map((plan) => ({
    key: `plan-${plan.plan}`,
    render: (_, row) => (
      <Switch
        checked={row.planAccess[plan.plan] !== false}
        disabled={!canWriteFinance || !planData || saving}
        size="small"
        onChange={(checked: boolean) =>
          setRowsOverride((current) =>
            togglePlanAccess(current ?? baseRows, row.key, plan.plan, checked),
          )
        }
      />
    ),
    title: (
      <Space size={4}>
        <span>{plan.displayName}</span>
        {focusedPlanKeySet.has(plan.plan) ? <Tag color="orange">问题</Tag> : null}
      </Space>
    ),
    width: 104,
  }));

  const columns: TableColumnsType<MatrixRow> = [
    {
      key: 'model',
      render: (_, row) => (
        <Flexbox gap={4}>
          <Space wrap size={6}>
            <Text strong>{row.displayName}</Text>
            {row.isDefault && <Tag color="green">默认</Tag>}
          </Space>
          <Text copyable type="secondary">
            {row.modelId}
          </Text>
          <Space wrap size={4}>
            <Tag>{row.provider}</Tag>
            {row.providerType ? <Tag color="cyan">{row.providerType}</Tag> : null}
            {row.groupKey ? <Tag color="purple">{row.groupName || row.groupKey}</Tag> : null}
            <Tag>{getAdminModelTypeLabel(row.modelType)}</Tag>
            <Tag color={PRICING_SOURCE_STATUS[row.effectivePricingSource].color}>
              {PRICING_SOURCE_STATUS[row.effectivePricingSource].label}
            </Tag>
          </Space>
        </Flexbox>
      ),
      title: t('admin.modelBillingMatrix.col.model', '模型'),
      width: 280,
    },
    {
      dataIndex: 'instanceNames',
      key: 'instanceNames',
      render: (names: string[]) => (
        <Space wrap size={[4, 4]}>
          {names.map((name) => (
            <Tag key={name}>{name}</Tag>
          ))}
        </Space>
      ),
      title: t('admin.modelBillingMatrix.col.instances', '来源实例'),
      width: 220,
    },
    ...planColumns,
    {
      dataIndex: 'pricingMultiplier',
      key: 'pricingMultiplier',
      render: (value: number | undefined, row) => (
        <InputNumber
          disabled={!canWriteSystem || !settings || saving}
          min={0.0001}
          placeholder="默认"
          precision={4}
          size="small"
          step={0.1}
          style={{ width: 96 }}
          value={value}
          onChange={(next: number | null) =>
            updateRow(row.key, { pricingMultiplier: toFiniteNumber(next) })
          }
        />
      ),
      title: t('admin.modelBillingMatrix.col.multiplier', '倍率'),
      width: 120,
    },
    {
      dataIndex: 'creditsPerDollar',
      key: 'creditsPerDollar',
      render: (value: number | undefined, row) => (
        <InputNumber
          disabled={!canWriteSystem || !settings || saving}
          min={1}
          placeholder="默认"
          size="small"
          style={{ width: 132 }}
          value={value}
          onChange={(next: number | null) =>
            updateRow(row.key, { creditsPerDollar: toFiniteNumber(next) })
          }
        />
      ),
      title: t('admin.modelBillingMatrix.col.creditsPerDollar', '每美元积分'),
      width: 152,
    },
    {
      fixed: 'right',
      key: 'actions',
      render: (_, row) => (
        <Button
          disabled={!canWriteSystem || !modelData || !settings || row.isDefault}
          loading={saving}
          size="small"
          onClick={() => handleSetDefault(row)}
        >
          {row.isDefault ? '当前默认' : '设为默认'}
        </Button>
      ),
      title: t('admin.modelBillingMatrix.col.actions', '操作'),
      width: 124,
    },
  ];
  const visibleColumns = canReadSettings
    ? columns
    : columns.filter(
        (column) =>
          !['pricingMultiplier', 'creditsPerDollar', 'actions'].includes(String(column.key)),
      );

  return (
    <AdminPageShell
      description={t('admin.modelBillingMatrix.subtitle', MATRIX_SUBTITLE)}
      title={t('admin.modelBillingMatrix.title', '模型与计费矩阵')}
      width="full"
    >
      <Flexbox gap={24}>
        <Alert showIcon message={t('admin.modelBillingMatrix.notice', MATRIX_NOTICE)} type="info" />

        {hasLoadError ? (
          <AdminPageError
            description={t(
              'admin.modelBillingMatrix.loadFailed',
              '部分模型、套餐或计费配置加载失败，请重试。',
            )}
            onRetry={refreshMatrixData}
          />
        ) : null}

        {canReadPlans && canReadSettings ? (
          <AdminSection
            description="检查服务商模型、套餐开放范围、默认模型和计费数据是否可以正常使用。"
            title={t('admin.modelBillingMatrix.configHealthSection', 'AI service health check')}
          >
            <Alert
              showIcon
              type={configHealthMeta.alertType as 'error' | 'success' | 'warning'}
              description={
                <Flexbox gap={10}>
                  <Space wrap size={[8, 8]}>
                    <Tag color={configHealthMeta.color}>{configHealthMeta.label}</Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthModels', 'Models')}:{' '}
                      {configHealth.summary.modelCount}
                    </Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthPlans', 'Plans')}:{' '}
                      {configHealth.summary.planCount}
                    </Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthDefaults', 'Defaults')}:{' '}
                      {configHealth.summary.defaultModelOkCount}/
                      {configHealth.summary.defaultModelTotal}
                    </Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthPricingOverrides', 'Pricing overrides')}:{' '}
                      {configHealth.summary.pricingOverrideCount}
                    </Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthPricingFallbacks', 'Pricing metadata')}:{' '}
                      {configHealth.summary.providerPricingModelCount}
                    </Tag>
                    <Tag>DB pricing: {configHealth.summary.databasePricingModelCount}</Tag>
                    <Tag>
                      LobeHub Official: {configHealth.summary.lobeHubOfficialPricingModelCount}
                    </Tag>
                    <Tag>Model Bank: {configHealth.summary.modelBankPricingModelCount}</Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthPricingMissing', 'Missing pricing')}:{' '}
                      {configHealth.summary.missingPricingModelCount}
                    </Tag>
                    <Tag>
                      {t('admin.modelBillingMatrix.healthAbilitiesMissing', 'Missing abilities')}:{' '}
                      {configHealth.summary.missingAbilityModelCount}
                    </Tag>
                  </Space>

                  <Flexbox gap={6}>
                    {configHealth.checks.map((check) => {
                      const meta = CONFIG_HEALTH_CHECK_STATUS[check.severity];

                      return (
                        <Space wrap align="start" key={check.key} size={6}>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          <Text>{check.title}</Text>
                          {typeof check.count === 'number' ? <Tag>{check.count}</Tag> : null}
                          {check.detail ? <Text type="secondary">{check.detail}</Text> : null}
                          {canFocusConfigHealthCheck(check) ? (
                            <Button
                              size="small"
                              type="link"
                              onClick={() => handleFocusConfigHealthCheck(check)}
                            >
                              {focusedHealthCheckKey === check.key ? '取消定位' : '定位'}
                            </Button>
                          ) : null}
                        </Space>
                      );
                    })}
                  </Flexbox>
                </Flexbox>
              }
              message={t(
                'admin.modelBillingMatrix.configHealthTitle',
                'Provider, model access, and billing configuration',
              )}
            />
          </AdminSection>
        ) : (
          <Alert
            showIcon
            type="info"
            message={t(
              'admin.modelBillingMatrix.scopedReadNotice',
              '当前仅显示此角色有权读取的模型、套餐或系统设置分区。',
            )}
          />
        )}

        {canReadSettings ? (
          <AdminSection
            title={t('admin.modelBillingMatrix.billingBasisSection', '全局计费基线')}
            description={t(
              'admin.modelBillingMatrix.billingBasisDescription',
              '在线平台支付保持关闭；这里仅维护全局积分倍率，单模型倍率、每美元积分和套餐开放范围继续在下方矩阵维护。',
            )}
          >
            <Text type="secondary">当前修改只影响后续计费计算，不会开启在线平台支付。</Text>

            <Space wrap align="start" size={24}>
              <Flexbox gap={8} style={{ minWidth: 220 }}>
                <Text strong>{t('admin.modelBillingMatrix.globalMultiplier', '全局积分倍率')}</Text>
                <InputNumber
                  disabled={!canWriteSystem || !settings || savingBillingBasis}
                  max={100}
                  min={0.0001}
                  precision={4}
                  step={0.1}
                  style={{ width: 180 }}
                  value={billingBasis.pricingMultiplier}
                  onChange={(next: number | null) =>
                    updateBillingBasis({
                      pricingMultiplier: toFiniteNumber(next) ?? DEFAULT_PRICING_CREDIT_MULTIPLIER,
                    })
                  }
                />
                <Text type="secondary">
                  {t(
                    'admin.modelBillingMatrix.globalMultiplierHelp',
                    '用于生成计费的默认倍率，单模型倍率会覆盖该值。',
                  )}
                </Text>
              </Flexbox>

              <Flexbox gap={8} style={{ minWidth: 220 }}>
                <Text strong>{t('admin.pricing.ordersEnabled', '在线平台支付（已关闭）')}</Text>
                <Switch
                  disabled
                  checked={false}
                  checkedChildren={t('admin.modelBillingMatrix.enabled', '启用')}
                  unCheckedChildren={t('admin.modelBillingMatrix.disabled', '停用')}
                />
                <Text type="secondary">
                  {t(
                    'admin.pricing.ordersEnabled.help',
                    '平台在线支付保持关闭，仅兑换码充值可用；此状态不可在后台开启。',
                  )}
                </Text>
              </Flexbox>
            </Space>

            <Space wrap>
              <Button
                disabled={!canWriteSystem || !settings}
                loading={savingBillingBasis}
                type="primary"
                onClick={handleSaveBillingBasis}
              >
                {t('admin.modelBillingMatrix.saveBillingBasis', '保存全局计费设置')}
              </Button>
              {billingBasisOverride && (
                <Button disabled={savingBillingBasis} onClick={() => setBillingBasisOverride(null)}>
                  {MATRIX_DISCARD_LABEL}
                </Button>
              )}
            </Space>
          </AdminSection>
        ) : null}

        {canReadSettings ? (
          <Alert
            showIcon
            message="默认模型健康检查"
            type={hasDefaultModelRisk ? 'warning' : 'success'}
            description={
              <Flexbox gap={8}>
                {Object.values(defaultModelHealth).map((health) => {
                  const meta = DEFAULT_HEALTH_STATUS[health.status];

                  return (
                    <Space wrap align="start" key={health.modelType} size={6}>
                      <Tag color="blue">{getAdminModelTypeLabel(health.modelType)}</Tag>
                      <Text>
                        {health.model
                          ? `${health.provider}/${health.model}`
                          : `${health.provider}/未配置`}
                      </Text>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      <Text type="secondary">{getDefaultModelHealthMessage(health)}</Text>
                    </Space>
                  );
                })}
              </Flexbox>
            }
          />
        ) : null}

        {focusedHealthCheck ? (
          <Alert
            showIcon
            description={`当前显示 ${displayRows.length}/${rows.length} 个相关模型。`}
            message={`已定位：${focusedHealthCheck.title}`}
            type="warning"
            action={
              <Button size="small" onClick={() => setFocusedHealthCheckKey(null)}>
                显示全部
              </Button>
            }
          />
        ) : null}

        <AdminSection
          description={`当前显示 ${displayRows.length}/${rows.length} 个模型`}
          title={t('admin.modelBillingMatrix.matrixSection', '模型权限与计费')}
        >
          <AdminResponsiveTable label="模型与计费矩阵">
            <Table
              columns={visibleColumns}
              dataSource={displayRows}
              loading={loading}
              locale={{ emptyText: <Empty description="暂无已启用的服务商模型" /> }}
              pagination={{ defaultPageSize: 50, hideOnSinglePage: true, showSizeChanger: true }}
              rowKey="key"
              scroll={{ x: 900 + plans.length * 104 }}
            />
          </AdminResponsiveTable>
        </AdminSection>

        <AdminFormActions label="模型与计费矩阵操作">
          {canReadPlans ? (
            <Button
              disabled={!canWriteFinance || !planData}
              loading={saving}
              type="primary"
              onClick={handleSaveAccess}
            >
              {MATRIX_ACCESS_SAVE_LABEL}
            </Button>
          ) : null}
          {canReadSettings ? (
            <Button
              disabled={!canWriteSystem || !settings}
              loading={saving}
              onClick={handleSavePricing}
            >
              {MATRIX_PRICING_SAVE_LABEL}
            </Button>
          ) : null}
          {rowsOverride && (
            <Button disabled={saving} onClick={() => setRowsOverride(null)}>
              {MATRIX_DISCARD_LABEL}
            </Button>
          )}
        </AdminFormActions>
      </Flexbox>
    </AdminPageShell>
  );
});

AdminModelBillingMatrixPage.displayName = 'AdminModelBillingMatrixPage';

export default AdminModelBillingMatrixPage;
