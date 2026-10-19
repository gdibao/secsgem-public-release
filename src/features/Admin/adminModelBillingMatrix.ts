import { DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';

export type BillingBasisValues = {
  pricingMultiplier: number;
};

export const buildBillingBasisValues = (settings?: {
  ordersManagementEnabled?: boolean | null;
  pricingCreditMultiplier?: number | null;
}): BillingBasisValues => ({
  pricingMultiplier:
    typeof settings?.pricingCreditMultiplier === 'number' &&
    Number.isFinite(settings.pricingCreditMultiplier) &&
    settings.pricingCreditMultiplier > 0
      ? settings.pricingCreditMultiplier
      : DEFAULT_PRICING_CREDIT_MULTIPLIER,
});

export const buildBillingBasisUpdates = (
  current: BillingBasisValues,
  baseline: BillingBasisValues,
): Array<{ key: 'pricing.creditMultiplier'; value: number }> =>
  current.pricingMultiplier === baseline.pricingMultiplier
    ? []
    : [{ key: 'pricing.creditMultiplier', value: current.pricingMultiplier }];

export type MatrixModelType =
  'chat' | 'embedding' | 'tts' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

export type MatrixPlan = {
  displayName: string;
  plan: string;
};

export type MatrixProviderPricingSource =
  'database' | 'lobehub-official' | 'missing' | 'model-bank';
export type MatrixPricingSource = MatrixProviderPricingSource | 'manual-override';

export type MatrixSourceModel = {
  displayName: string | null;
  groupKey?: string | null;
  groupName?: string | null;
  hasModelAbilities?: boolean;
  hasModelPricing?: boolean;
  instanceId: string;
  instanceName: string;
  modelId: string;
  modelType: MatrixModelType;
  pricingSource?: MatrixProviderPricingSource;
  priority: number;
  providerType?: string | null;
};

export type MatrixPricingRule = {
  creditsPerDollar?: number;
  group?: string;
  instanceId?: string;
  model?: string;
  multiplier?: number;
  provider?: string;
  providerType?: string;
};

export type MatrixPlanRule = {
  allowlist?: string[];
  blocklist?: string[];
  mode: 'allowlist' | 'blocklist';
};

export type MatrixPlanRules = Partial<Record<MatrixModelType, MatrixPlanRule>>;

export type MatrixRow = {
  creditsPerDollar?: number;
  displayName: string;
  effectivePricingSource: MatrixPricingSource;
  groupKey?: string | null;
  groupName?: string | null;
  hasModelAbilities: boolean;
  hasModelPricing: boolean;
  instanceIds: string[];
  instanceNames: string[];
  isDefault: boolean;
  key: string;
  modelId: string;
  modelType: MatrixModelType;
  planAccess: Record<string, boolean>;
  pricingInstanceId?: string;
  pricingMultiplier?: number;
  pricingSources: MatrixProviderPricingSource[];
  provider: string;
  providerType?: string | null;
  providerTypes: string[];
};

export type MatrixDefaultModelConflict = {
  displayName: string;
  modelId: string;
  modelType: MatrixModelType;
  provider: string;
};

export type MatrixDefaultModelType = Extract<MatrixModelType, 'chat' | 'image' | 'video'>;

export type MatrixDefaultModelHealthStatus =
  'ok' | 'not_configured' | 'not_enabled' | 'type_mismatch' | 'denied_by_free_plan';

export type MatrixDefaultModelHealth = {
  actualModelType?: MatrixModelType;
  displayName?: string;
  model?: string | null;
  modelType: MatrixDefaultModelType;
  provider: string;
  status: MatrixDefaultModelHealthStatus;
};

export type MatrixDefaultModelHealthInput = Partial<
  Record<MatrixDefaultModelType, { model?: string | null; provider?: string | null }>
>;

export type MatrixConfigHealthSeverity = 'error' | 'info' | 'ok' | 'warning';

export type MatrixConfigHealthCheck = {
  count?: number;
  detail?: string;
  key: string;
  severity: MatrixConfigHealthSeverity;
  title: string;
};

export type MatrixConfigHealth = {
  checks: MatrixConfigHealthCheck[];
  status: Exclude<MatrixConfigHealthSeverity, 'info'>;
  summary: {
    blockedModelCount: number;
    databasePricingModelCount: number;
    defaultModelIssueCount: number;
    defaultModelOkCount: number;
    defaultModelTotal: number;
    lobeHubOfficialPricingModelCount: number;
    missingAbilityModelCount: number;
    missingPricingModelCount: number;
    modelBankPricingModelCount: number;
    modelCount: number;
    planCount: number;
    plansWithoutAccessCount: number;
    pricingFallbackModelCount: number;
    pricingOverrideCount: number;
    providerPricingModelCount: number;
  };
};

export type MatrixConfigHealthFocus = {
  planKeys: string[];
  rowKeys: string[];
};

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wildcardMatch = (pattern: string, value: string) => {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;

  const regexp = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return regexp.test(value);
};

const normalizeGroupKey = (groupKey?: string | null) => groupKey?.trim().toLowerCase();
const normalizeTextKey = (value?: string | null) => value?.trim().toLowerCase();

const PRICING_SOURCE_PRIORITY: Record<MatrixPricingSource, number> = {
  'manual-override': 0,
  'database': 1,
  'lobehub-official': 2,
  'model-bank': 3,
  'missing': 4,
};

const hasPricingOverrideValues = ({
  creditsPerDollar,
  pricingMultiplier,
}: {
  creditsPerDollar?: number;
  pricingMultiplier?: number;
}) => Number.isFinite(pricingMultiplier) || Number.isFinite(creditsPerDollar);

const resolveSourceModelPricingSource = (model: MatrixSourceModel): MatrixProviderPricingSource =>
  model.pricingSource ?? (model.hasModelPricing ? 'database' : 'missing');

const resolveEffectivePricingSource = ({
  creditsPerDollar,
  pricingMultiplier,
  pricingSources,
}: {
  creditsPerDollar?: number;
  pricingMultiplier?: number;
  pricingSources: MatrixProviderPricingSource[];
}): MatrixPricingSource => {
  if (hasPricingOverrideValues({ creditsPerDollar, pricingMultiplier })) return 'manual-override';
  if (pricingSources.includes('database')) return 'database';
  if (pricingSources.includes('lobehub-official')) return 'lobehub-official';
  if (pricingSources.includes('model-bank')) return 'model-bank';

  return 'missing';
};

const matchesEntry = (entry: string, modelId: string, groupKey?: string | null) => {
  const normalized = entry.trim().toLowerCase();
  if (!normalized) return false;

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > -1) {
    const groupPattern = normalized.slice(0, separatorIndex).trim();
    const modelPattern = normalized.slice(separatorIndex + 1).trim();
    if (!groupPattern || !modelPattern) return false;

    return (
      wildcardMatch(groupPattern, normalizeGroupKey(groupKey) || 'default') &&
      wildcardMatch(modelPattern, modelId.toLowerCase())
    );
  }

  return wildcardMatch(normalized, modelId.toLowerCase());
};

const matchesList = (list: string[] | undefined, modelId: string, groupKey?: string | null) =>
  (list ?? []).some((item) => matchesEntry(item, modelId, groupKey));

const isAllowedByRule = (
  rule: MatrixPlanRule | undefined,
  modelId: string,
  groupKey?: string | null,
) => {
  if (!rule) return true;
  if (rule.mode === 'allowlist') return matchesList(rule.allowlist, modelId, groupKey);

  return !matchesList(rule.blocklist, modelId, groupKey);
};

const findPricingRule = ({
  groupKey,
  instanceId,
  modelId,
  pricingRules,
  provider,
  providerType,
}: {
  groupKey?: string | null;
  instanceId?: string | null;
  modelId: string;
  pricingRules: MatrixPricingRule[];
  provider: string;
  providerType?: string | null;
}) =>
  pricingRules
    .filter((rule) => {
      const normalizedGroup = normalizeGroupKey(groupKey);
      const normalizedInstanceId = normalizeTextKey(instanceId);
      const ruleGroup = rule.group?.trim().toLowerCase();
      const ruleInstanceId = rule.instanceId?.trim().toLowerCase();
      const ruleProvider = rule.provider?.trim().toLowerCase();
      const normalizedProviderType = normalizeTextKey(providerType);
      const ruleProviderType = rule.providerType?.trim().toLowerCase();
      const ruleModel = rule.model?.trim().toLowerCase();
      const groupMatched = ruleGroup ? ruleGroup === normalizedGroup : true;
      const instanceMatched = ruleInstanceId ? ruleInstanceId === normalizedInstanceId : true;
      const providerMatched = !ruleProvider || ruleProvider === '*' || ruleProvider === provider;
      const providerTypeMatched = ruleProviderType
        ? ruleProviderType === normalizedProviderType
        : true;
      const modelMatched = !ruleModel || ruleModel === '*' || ruleModel === modelId.toLowerCase();

      return (
        groupMatched && instanceMatched && providerMatched && providerTypeMatched && modelMatched
      );
    })
    .sort((a, b) => {
      const score = (rule: MatrixPricingRule) =>
        (rule.instanceId ? 8 : 0) +
        (rule.group ? 4 : 0) +
        (rule.providerType ? 3 : 0) +
        (rule.provider && rule.provider !== '*' ? 2 : 0) +
        (rule.model && rule.model !== '*' ? 2 : 0) +
        (Number.isFinite(rule.creditsPerDollar) ? 1 : 0);

      return score(b) - score(a);
    })[0];

export const buildMatrixRows = ({
  defaultModel,
  defaultModelsByType,
  defaultProvider = 'newapi',
  models,
  plans,
  pricingRules,
  planRulesByPlan,
}: {
  defaultModel?: string | null;
  defaultModelsByType?: Partial<
    Record<MatrixModelType, { model?: string | null; provider?: string | null }>
  >;
  defaultProvider?: string | null;
  models: MatrixSourceModel[];
  plans: MatrixPlan[];
  pricingRules: MatrixPricingRule[];
  planRulesByPlan: Record<string, MatrixPlanRules | null | undefined>;
}): MatrixRow[] => {
  const grouped = new Map<string, MatrixSourceModel[]>();

  for (const model of models) {
    const groupKey = normalizeGroupKey(model.groupKey);
    const providerType = normalizeTextKey(model.providerType);
    const key = groupKey
      ? providerType && providerType !== 'newapi'
        ? `newapi:${providerType}:${groupKey}:${model.modelType}:${model.modelId}`
        : `newapi:${groupKey}:${model.modelType}:${model.modelId}`
      : providerType && providerType !== 'newapi'
        ? `newapi:${providerType}:${model.modelType}:${model.modelId}`
        : `newapi:${model.modelType}:${model.modelId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), model]);
  }

  return Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sorted = [...rows].sort((a, b) => a.priority - b.priority);
      const first = sorted[0];
      const provider = 'newapi';
      const groupKey = normalizeGroupKey(first.groupKey);
      const providerTypes = Array.from(
        new Set(sorted.map((item) => normalizeTextKey(item.providerType)).filter(Boolean)),
      ) as string[];
      const providerType = providerTypes.length === 1 ? providerTypes[0] : undefined;
      const instanceIds = sorted.map((item) => item.instanceId);
      const instanceId = instanceIds.length === 1 ? instanceIds[0] : undefined;
      const pricingSources = Array.from(new Set(sorted.map(resolveSourceModelPricingSource))).sort(
        (a, b) => PRICING_SOURCE_PRIORITY[a] - PRICING_SOURCE_PRIORITY[b],
      );
      const pricingRule = findPricingRule({
        groupKey,
        instanceId,
        modelId: first.modelId,
        pricingRules,
        provider,
        providerType,
      });
      const effectivePricingSource = resolveEffectivePricingSource({
        creditsPerDollar: pricingRule?.creditsPerDollar,
        pricingMultiplier: pricingRule?.multiplier,
        pricingSources,
      });

      return {
        creditsPerDollar: pricingRule?.creditsPerDollar,
        displayName: first.displayName || first.modelId,
        effectivePricingSource,
        groupKey,
        groupName: first.groupName,
        hasModelAbilities: sorted.some((item) => item.hasModelAbilities === true),
        hasModelPricing: pricingSources.some((source) => source !== 'missing'),
        instanceIds,
        instanceNames: sorted.map((item) => item.instanceName),
        isDefault:
          first.modelType === 'chat'
            ? (defaultProvider || provider).toLowerCase() === provider &&
              defaultModel === first.modelId
            : (defaultModelsByType?.[first.modelType]?.provider || provider).toLowerCase() ===
                provider && defaultModelsByType?.[first.modelType]?.model === first.modelId,
        key,
        modelId: first.modelId,
        modelType: first.modelType,
        planAccess: Object.fromEntries(
          plans.map((plan) => [
            plan.plan,
            isAllowedByRule(planRulesByPlan[plan.plan]?.[first.modelType], first.modelId, groupKey),
          ]),
        ),
        pricingMultiplier: pricingRule?.multiplier,
        pricingInstanceId: pricingRule?.instanceId ?? (providerType ? instanceId : undefined),
        pricingSources,
        provider,
        providerType,
        providerTypes,
      };
    })
    .sort((a, b) => a.modelType.localeCompare(b.modelType) || a.modelId.localeCompare(b.modelId));
};

const rowModelRuleEntry = (row: MatrixRow) =>
  row.groupKey ? `${row.groupKey}:${row.modelId}` : row.modelId;

export const togglePlanAccess = (
  rows: MatrixRow[],
  rowKey: string,
  plan: string,
  allowed: boolean,
): MatrixRow[] =>
  rows.map((row) =>
    row.key === rowKey ? { ...row, planAccess: { ...row.planAccess, [plan]: allowed } } : row,
  );

export const findFreePlanDefaultModelConflict = (
  rows: MatrixRow[],
): MatrixDefaultModelConflict | null => {
  const defaultRows = rows.filter(
    (item) =>
      item.isDefault &&
      ['chat', 'image', 'video'].includes(item.modelType) &&
      sameProvider(item.provider, 'newapi'),
  );
  const row = defaultRows.find((item) => {
    const matchingRows = defaultRows.filter(
      (candidate) =>
        candidate.modelType === item.modelType &&
        sameProvider(candidate.provider, item.provider) &&
        sameModel(candidate.modelId, item.modelId),
    );

    return (
      matchingRows.length > 0 &&
      matchingRows.every((candidate) => candidate.planAccess.free === false)
    );
  });

  return row
    ? {
        displayName: row.displayName,
        modelId: row.modelId,
        modelType: row.modelType,
        provider: row.provider,
      }
    : null;
};

const defaultModelTypes = ['chat', 'image', 'video'] as const satisfies MatrixDefaultModelType[];

const sameProvider = (left?: string | null, right?: string | null) =>
  (normalizeTextKey(left) || 'newapi') === (normalizeTextKey(right) || 'newapi');

const sameModel = (left?: string | null, right?: string | null) =>
  normalizeTextKey(left) === normalizeTextKey(right);

export const getDefaultModelHealth = (
  rows: MatrixRow[],
  defaults: MatrixDefaultModelHealthInput,
): Record<MatrixDefaultModelType, MatrixDefaultModelHealth> =>
  Object.fromEntries(
    defaultModelTypes.map((modelType) => {
      const config = defaults[modelType];
      const model = config?.model?.trim();
      const provider = normalizeTextKey(config?.provider) || 'newapi';

      if (!model) {
        return [
          modelType,
          {
            model,
            modelType,
            provider,
            status: 'not_configured',
          },
        ];
      }

      const matchingRows = rows.filter(
        (item) =>
          item.modelType === modelType &&
          sameProvider(item.provider, provider) &&
          sameModel(item.modelId, model),
      );
      const availableRow = matchingRows.find((item) => item.planAccess.free !== false);
      const row = availableRow ?? matchingRows[0];

      if (row) {
        return [
          modelType,
          {
            displayName: row.displayName,
            model: row.modelId,
            modelType,
            provider,
            status: availableRow ? 'ok' : 'denied_by_free_plan',
          },
        ];
      }

      const typeMismatchRow = rows.find(
        (item) => sameProvider(item.provider, provider) && sameModel(item.modelId, model),
      );

      if (typeMismatchRow) {
        return [
          modelType,
          {
            actualModelType: typeMismatchRow.modelType,
            displayName: typeMismatchRow.displayName,
            model,
            modelType,
            provider,
            status: 'type_mismatch',
          },
        ];
      }

      return [
        modelType,
        {
          model,
          modelType,
          provider,
          status: 'not_enabled',
        },
      ];
    }),
  ) as Record<MatrixDefaultModelType, MatrixDefaultModelHealth>;

export const buildPlanModelRulesFromRows = (rows: MatrixRow[], plans: MatrixPlan[]) => {
  const result: Record<string, MatrixPlanRules | undefined> = {};

  for (const plan of plans) {
    const rules: MatrixPlanRules = {};
    const rowsByType = new Map<MatrixModelType, MatrixRow[]>();

    for (const row of rows) {
      rowsByType.set(row.modelType, [...(rowsByType.get(row.modelType) ?? []), row]);
    }

    for (const [modelType, typedRows] of rowsByType.entries()) {
      const hasDeniedRow = typedRows.some((row) => row.planAccess[plan.plan] === false);
      if (!hasDeniedRow) continue;

      rules[modelType] = {
        allowlist: typedRows
          .filter((row) => row.planAccess[plan.plan] !== false)
          .map(rowModelRuleEntry),
        mode: 'allowlist',
      };
    }

    result[plan.plan] = Object.keys(rules).length > 0 ? rules : undefined;
  }

  return result;
};

export const getPlanModelRulesSaveErrorMessage = (error: unknown) => {
  const candidate = error as {
    code?: string;
    data?: { code?: string };
    message?: string;
  } | null;
  const code = candidate?.data?.code ?? candidate?.code;
  const message = candidate?.message;

  if (message === 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN') {
    return '默认模型未被免费套餐允许，系统已阻止保存。请先开启免费套餐权限或更换默认模型。';
  }

  if (code === 'FORBIDDEN') {
    return '当前账号没有保存套餐模型权限所需的 finance.write 权限。';
  }

  if (code === 'NOT_FOUND') {
    return '部分套餐已不存在，请刷新套餐列表后重试。';
  }

  if (code === 'BAD_REQUEST') {
    return '套餐模型权限数据无效，请刷新页面后重试。';
  }

  return '保存套餐模型权限失败，请刷新页面后重试。';
};

export const buildPricingRulesFromRows = (rows: MatrixRow[]): MatrixPricingRule[] =>
  rows.flatMap((row) => {
    const hasMultiplier =
      Number.isFinite(row.pricingMultiplier) && Number(row.pricingMultiplier) > 0;
    const hasCreditsPerDollar =
      Number.isFinite(row.creditsPerDollar) && Number(row.creditsPerDollar) > 0;
    if (!hasMultiplier && !hasCreditsPerDollar) return [];

    return [
      {
        ...(hasCreditsPerDollar ? { creditsPerDollar: row.creditsPerDollar } : {}),
        ...(row.groupKey ? { group: row.groupKey } : {}),
        ...(row.pricingInstanceId ? { instanceId: row.pricingInstanceId } : {}),
        model: row.modelId,
        ...(hasMultiplier ? { multiplier: row.pricingMultiplier } : {}),
        provider: row.provider,
        ...(row.providerType ? { providerType: row.providerType } : {}),
      },
    ];
  });

const aggregateHealthStatus = (checks: MatrixConfigHealthCheck[]): MatrixConfigHealth['status'] => {
  if (checks.some((check) => check.severity === 'error')) return 'error';
  if (checks.some((check) => check.severity === 'warning')) return 'warning';

  return 'ok';
};

const hasPricingOverride = (row: MatrixRow) =>
  hasPricingOverrideValues({
    creditsPerDollar: row.creditsPerDollar,
    pricingMultiplier: row.pricingMultiplier,
  });

const hasProviderPricingMetadata = (row: MatrixRow) =>
  row.pricingSources.some((source) => source !== 'missing');

const isProviderPricingFallbackRow = (row: MatrixRow) =>
  row.effectivePricingSource === 'database' ||
  row.effectivePricingSource === 'lobehub-official' ||
  row.effectivePricingSource === 'model-bank';

export const getMatrixConfigHealth = ({
  defaultModelHealth,
  globalPricingMultiplier = 1,
  plans,
  rows,
}: {
  defaultModelHealth: Record<MatrixDefaultModelType, MatrixDefaultModelHealth>;
  globalPricingMultiplier?: number;
  plans: MatrixPlan[];
  rows: MatrixRow[];
}): MatrixConfigHealth => {
  const defaultHealthItems = Object.values(defaultModelHealth);
  const defaultModelIssues = defaultHealthItems.filter((item) => item.status !== 'ok');
  const defaultModelErrors = defaultModelIssues.filter((item) => item.status !== 'not_configured');
  const blockedModels =
    plans.length === 0
      ? []
      : rows.filter((row) => plans.every((plan) => row.planAccess[plan.plan] === false));
  const plansWithoutAccess = plans.filter(
    (plan) => rows.length > 0 && rows.every((row) => row.planAccess[plan.plan] === false),
  );
  const pricingOverrideRows = rows.filter(hasPricingOverride);
  const providerPricingRows = rows.filter(hasProviderPricingMetadata);
  const providerPricingFallbackRows = rows.filter(isProviderPricingFallbackRow);
  const databasePricingRows = rows.filter((row) => row.effectivePricingSource === 'database');
  const lobeHubOfficialPricingRows = rows.filter(
    (row) => row.effectivePricingSource === 'lobehub-official',
  );
  const modelBankPricingRows = rows.filter((row) => row.effectivePricingSource === 'model-bank');
  const missingPricingRows = rows.filter((row) => row.effectivePricingSource === 'missing');
  const missingAbilityRows = rows.filter((row) => row.hasModelAbilities !== true);
  const pricingOverrideCount = pricingOverrideRows.length;
  const pricingFallbackModelCount = providerPricingFallbackRows.length;
  const checks: MatrixConfigHealthCheck[] = [];

  if (rows.length === 0) {
    checks.push({
      key: 'no-enabled-models',
      severity: 'error',
      title: 'No enabled provider models',
    });
  }

  if (plans.length === 0) {
    checks.push({
      key: 'no-plans',
      severity: 'error',
      title: 'No subscription plans configured',
    });
  }

  if (defaultModelIssues.length > 0) {
    checks.push({
      count: defaultModelIssues.length,
      key: 'default-models',
      severity: defaultModelErrors.length > 0 ? 'error' : 'warning',
      title: 'Default model configuration needs attention',
    });
  }

  if (plansWithoutAccess.length > 0) {
    checks.push({
      count: plansWithoutAccess.length,
      detail: plansWithoutAccess.map((plan) => plan.displayName || plan.plan).join(', '),
      key: 'plans-without-models',
      severity: 'error',
      title: 'Some plans have no visible models',
    });
  }

  if (blockedModels.length > 0) {
    checks.push({
      count: blockedModels.length,
      key: 'blocked-models',
      severity: 'warning',
      title: 'Some enabled models are hidden from every plan',
    });
  }

  if (!Number.isFinite(globalPricingMultiplier) || globalPricingMultiplier <= 0) {
    checks.push({
      key: 'global-pricing-multiplier',
      severity: 'warning',
      title: 'Global pricing multiplier makes AI usage free',
    });
  }

  if (providerPricingFallbackRows.length > 0) {
    checks.push({
      count: providerPricingFallbackRows.length,
      key: 'pricing-fallbacks',
      severity: 'info',
      title: 'Some models rely on provider/manual pricing',
    });
  }

  if (missingPricingRows.length > 0) {
    checks.push({
      count: missingPricingRows.length,
      key: 'missing-model-pricing',
      severity: 'error',
      title: 'Models without reliable pricing are blocked from platform billing',
    });
  }

  if (missingAbilityRows.length > 0) {
    checks.push({
      count: missingAbilityRows.length,
      key: 'missing-model-abilities',
      severity: 'info',
      title: 'Some models are missing ability metadata',
    });
  }

  if (checks.length === 0) {
    checks.push({
      key: 'healthy',
      severity: 'ok',
      title: 'AI provider, model access, and billing basics look healthy',
    });
  }

  return {
    checks,
    status: aggregateHealthStatus(checks),
    summary: {
      blockedModelCount: blockedModels.length,
      databasePricingModelCount: databasePricingRows.length,
      defaultModelIssueCount: defaultModelIssues.length,
      defaultModelOkCount: defaultHealthItems.filter((item) => item.status === 'ok').length,
      defaultModelTotal: defaultHealthItems.length,
      lobeHubOfficialPricingModelCount: lobeHubOfficialPricingRows.length,
      missingAbilityModelCount: missingAbilityRows.length,
      missingPricingModelCount: missingPricingRows.length,
      modelBankPricingModelCount: modelBankPricingRows.length,
      modelCount: rows.length,
      planCount: plans.length,
      plansWithoutAccessCount: plansWithoutAccess.length,
      pricingFallbackModelCount,
      pricingOverrideCount,
      providerPricingModelCount: providerPricingRows.length,
    },
  };
};

export const getMatrixConfigHealthFocus = ({
  checkKey,
  defaultModelHealth,
  plans,
  rows,
}: {
  checkKey: string;
  defaultModelHealth: Record<MatrixDefaultModelType, MatrixDefaultModelHealth>;
  plans: MatrixPlan[];
  rows: MatrixRow[];
}): MatrixConfigHealthFocus => {
  if (checkKey === 'no-plans' || checkKey === 'global-pricing-multiplier') {
    return {
      planKeys: [],
      rowKeys: rows.map((row) => row.key),
    };
  }

  if (checkKey === 'plans-without-models') {
    const planKeys = plans
      .filter((plan) => rows.length > 0 && rows.every((row) => row.planAccess[plan.plan] === false))
      .map((plan) => plan.plan);

    return {
      planKeys,
      rowKeys: rows
        .filter((row) => planKeys.some((plan) => row.planAccess[plan] === false))
        .map((row) => row.key),
    };
  }

  if (checkKey === 'blocked-models') {
    return {
      planKeys: plans.map((plan) => plan.plan),
      rowKeys: rows
        .filter(
          (row) => plans.length > 0 && plans.every((plan) => row.planAccess[plan.plan] === false),
        )
        .map((row) => row.key),
    };
  }

  if (checkKey === 'pricing-fallbacks') {
    return {
      planKeys: [],
      rowKeys: rows.filter(isProviderPricingFallbackRow).map((row) => row.key),
    };
  }

  if (checkKey === 'missing-model-pricing') {
    return {
      planKeys: [],
      rowKeys: rows.filter((row) => row.effectivePricingSource === 'missing').map((row) => row.key),
    };
  }

  if (checkKey === 'missing-model-abilities') {
    return {
      planKeys: [],
      rowKeys: rows.filter((row) => row.hasModelAbilities !== true).map((row) => row.key),
    };
  }

  if (checkKey === 'default-models') {
    const defaultIssues = Object.values(defaultModelHealth).filter((item) => item.status !== 'ok');

    return {
      planKeys: defaultIssues.some((item) => item.status === 'denied_by_free_plan') ? ['free'] : [],
      rowKeys: rows
        .filter((row) =>
          defaultIssues.some(
            (item) =>
              item.model &&
              sameProvider(row.provider, item.provider) &&
              sameModel(row.modelId, item.model),
          ),
        )
        .map((row) => row.key),
    };
  }

  if (checkKey === 'healthy') {
    return {
      planKeys: [],
      rowKeys: rows.map((row) => row.key),
    };
  }

  return {
    planKeys: [],
    rowKeys: [],
  };
};
