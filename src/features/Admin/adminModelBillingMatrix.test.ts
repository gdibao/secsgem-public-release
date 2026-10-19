import { describe, expect, it } from 'vitest';

import {
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
  type MatrixSourceModel,
  togglePlanAccess,
} from './adminModelBillingMatrix';

describe('adminModelBillingMatrix', () => {
  const plans = [
    { displayName: 'Free', plan: 'free' },
    { displayName: 'Starter', plan: 'starter' },
  ];

  const models = [
    {
      displayName: 'DeepSeek Chat',
      instanceId: 'inst-1',
      instanceName: '主网关',
      modelId: 'deepseek-chat',
      modelType: 'chat' as const,
      priority: 0,
    },
    {
      displayName: 'DeepSeek Chat Backup',
      instanceId: 'inst-2',
      instanceName: '备用网关',
      modelId: 'deepseek-chat',
      modelType: 'chat' as const,
      priority: 1,
    },
    {
      displayName: null,
      instanceId: 'inst-3',
      instanceName: '图像网关',
      modelId: 'flux-kontext',
      modelType: 'image' as const,
      priority: 0,
    },
  ];

  it('ignores deprecated order settings while preserving pricing multiplier edits', () => {
    expect(
      buildBillingBasisValues({
        ordersManagementEnabled: true,
        pricingCreditMultiplier: 1.5,
      }),
    ).toEqual({ pricingMultiplier: 1.5 });
    expect(buildBillingBasisUpdates({ pricingMultiplier: 2 }, { pricingMultiplier: 1 })).toEqual([
      { key: 'pricing.creditMultiplier', value: 2 },
    ]);
    expect(buildBillingBasisUpdates({ pricingMultiplier: 1 }, { pricingMultiplier: 1 })).toEqual(
      [],
    );
  });

  it('accepts optional model metadata flags on source models', () => {
    const sourceModel: MatrixSourceModel = {
      displayName: 'Metadata Model',
      hasModelAbilities: false,
      hasModelPricing: true,
      instanceId: 'inst-metadata',
      instanceName: 'Metadata Gateway',
      modelId: 'metadata-model',
      modelType: 'chat',
      priority: 0,
    };

    expect(sourceModel.hasModelPricing).toBe(true);
    expect(sourceModel.hasModelAbilities).toBe(false);
  });

  it('carries pricing and ability metadata flags from any grouped source model', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'Grouped Model Primary',
          hasModelAbilities: false,
          hasModelPricing: false,
          instanceId: 'inst-grouped-a',
          instanceName: 'Grouped Gateway A',
          modelId: 'grouped-model',
          modelType: 'chat',
          priority: 0,
        },
        {
          displayName: 'Grouped Model Backup',
          hasModelAbilities: true,
          hasModelPricing: true,
          instanceId: 'inst-grouped-b',
          instanceName: 'Grouped Gateway B',
          modelId: 'grouped-model',
          modelType: 'chat',
          priority: 1,
        },
      ],
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });

    expect(rows[0]).toMatchObject({
      hasModelAbilities: true,
      hasModelPricing: true,
      key: 'newapi:chat:grouped-model',
    });
  });

  it('preserves pricing sources from grouped source models', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'Grouped Model Primary',
          hasModelAbilities: true,
          hasModelPricing: true,
          instanceId: 'inst-database',
          instanceName: 'Database Gateway',
          modelId: 'priced-model',
          modelType: 'chat',
          pricingSource: 'database',
          priority: 0,
        },
        {
          displayName: 'Grouped Model LobeHub Official',
          hasModelAbilities: true,
          hasModelPricing: true,
          instanceId: 'inst-lobehub-official',
          instanceName: 'LobeHub Official Gateway',
          modelId: 'priced-model',
          modelType: 'chat',
          pricingSource: 'lobehub-official',
          priority: 1,
        },
        {
          displayName: 'Grouped Model Backup',
          hasModelAbilities: true,
          hasModelPricing: true,
          instanceId: 'inst-model-bank',
          instanceName: 'Model Bank Gateway',
          modelId: 'priced-model',
          modelType: 'chat',
          pricingSource: 'model-bank',
          priority: 2,
        },
      ] as MatrixSourceModel[],
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });

    expect(rows[0]).toMatchObject({
      effectivePricingSource: 'database',
      hasModelPricing: true,
      pricingSources: ['database', 'lobehub-official', 'model-bank'],
    });
  });

  it('marks manual pricing overrides as the effective pricing source', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'Override Model',
          hasModelAbilities: true,
          hasModelPricing: false,
          instanceId: 'inst-override',
          instanceName: 'Override Gateway',
          modelId: 'override-model',
          modelType: 'chat',
          pricingSource: 'missing',
          priority: 0,
        },
      ] as MatrixSourceModel[],
      plans,
      planRulesByPlan: {},
      pricingRules: [{ model: 'override-model', multiplier: 1.35, provider: 'newapi' }],
    });

    expect(rows[0]).toMatchObject({
      effectivePricingSource: 'manual-override',
      hasModelPricing: false,
      pricingSources: ['missing'],
    });
  });

  it('deduplicates models and marks default/pricing/plan access', () => {
    const rows = buildMatrixRows({
      defaultModel: 'deepseek-chat',
      defaultModelsByType: {
        image: { model: 'flux-kontext', provider: 'newapi' },
      },
      defaultProvider: 'newapi',
      models,
      plans,
      planRulesByPlan: {
        free: { chat: { allowlist: ['deepseek-chat'], mode: 'allowlist' } },
        starter: { image: { blocklist: ['flux-*'], mode: 'blocklist' } },
      },
      pricingRules: [{ model: 'deepseek-chat', multiplier: 0.8, provider: 'newapi' }],
    });

    expect(rows).toMatchObject([
      {
        creditsPerDollar: undefined,
        displayName: 'DeepSeek Chat',
        instanceNames: ['主网关', '备用网关'],
        isDefault: true,
        key: 'newapi:chat:deepseek-chat',
        modelId: 'deepseek-chat',
        modelType: 'chat',
        planAccess: { free: true, starter: true },
        pricingMultiplier: 0.8,
        provider: 'newapi',
      },
      {
        creditsPerDollar: undefined,
        displayName: 'flux-kontext',
        instanceNames: ['图像网关'],
        isDefault: true,
        key: 'newapi:image:flux-kontext',
        modelId: 'flux-kontext',
        modelType: 'image',
        planAccess: { free: true, starter: false },
        pricingMultiplier: undefined,
        provider: 'newapi',
      },
    ]);
  });

  it('toggles plan access and serializes allowlist rules by plan/type', () => {
    const rows = buildMatrixRows({
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });
    const nextRows = togglePlanAccess(rows, 'newapi:image:flux-kontext', 'starter', false);

    expect(buildPlanModelRulesFromRows(nextRows, plans)).toEqual({
      free: undefined,
      starter: {
        image: { allowlist: [], mode: 'allowlist' },
      },
    });
  });

  it('explains protected-default and permission failures when saving plan access', () => {
    expect(
      getPlanModelRulesSaveErrorMessage({ message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN' }),
    ).toContain('默认模型');
    expect(
      getPlanModelRulesSaveErrorMessage({ data: { code: 'FORBIDDEN' }, message: 'forbidden' }),
    ).toContain('finance.write');
    expect(getPlanModelRulesSaveErrorMessage({ data: { code: 'NOT_FOUND' } })).toContain(
      '套餐已不存在',
    );
  });

  it('keeps newapi groups as separate matrix rows and serializes group-qualified access rules', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'GPT Basic',
          groupKey: 'basic',
          groupName: 'Basic Group',
          instanceId: 'inst-basic',
          instanceName: 'Basic Gateway',
          modelId: 'gpt-4o-mini',
          modelType: 'chat',
          priority: 0,
        },
        {
          displayName: 'GPT Pro',
          groupKey: 'pro',
          groupName: 'Pro Group',
          instanceId: 'inst-pro',
          instanceName: 'Pro Gateway',
          modelId: 'gpt-4o-mini',
          modelType: 'chat',
          priority: 0,
        },
      ],
      plans,
      planRulesByPlan: {
        free: { chat: { allowlist: ['basic:gpt-4o-mini'], mode: 'allowlist' } },
        starter: { chat: { allowlist: ['pro:gpt-4o-mini'], mode: 'allowlist' } },
      },
      pricingRules: [],
    });

    expect(rows.map((row) => row.key)).toEqual([
      'newapi:basic:chat:gpt-4o-mini',
      'newapi:pro:chat:gpt-4o-mini',
    ]);
    expect(rows.map((row) => row.planAccess)).toEqual([
      { free: true, starter: false },
      { free: false, starter: true },
    ]);

    const starterProOnly = togglePlanAccess(
      rows,
      'newapi:basic:chat:gpt-4o-mini',
      'starter',
      false,
    );
    expect(buildPlanModelRulesFromRows(starterProOnly, plans).starter).toEqual({
      chat: { allowlist: ['pro:gpt-4o-mini'], mode: 'allowlist' },
    });
  });

  it('serializes pricing rules only for rows with overrides', () => {
    const rows = buildMatrixRows({
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    }).map((row) =>
      row.modelId === 'deepseek-chat'
        ? { ...row, creditsPerDollar: 1_000_000, pricingMultiplier: 0.9 }
        : row,
    );

    expect(buildPricingRulesFromRows(rows)).toEqual([
      {
        creditsPerDollar: 1_000_000,
        model: 'deepseek-chat',
        multiplier: 0.9,
        provider: 'newapi',
      },
    ]);
  });

  it('ignores non-positive pricing multipliers when serializing pricing rules', () => {
    const rows = buildMatrixRows({
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    }).map((row) => ({ ...row, pricingMultiplier: 0 }));

    expect(buildPricingRulesFromRows(rows)).toEqual([]);
  });

  it('ignores non-positive credits-per-dollar overrides when serializing pricing rules', () => {
    const rows = buildMatrixRows({
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    }).map((row) => ({ ...row, creditsPerDollar: 0 }));

    expect(buildPricingRulesFromRows(rows)).toEqual([]);
  });

  it('serializes pricing rules with group keys', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'GPT Pro',
          groupKey: 'pro',
          groupName: 'Pro Group',
          instanceId: 'inst-pro',
          instanceName: 'Pro Gateway',
          modelId: 'gpt-4o-mini',
          modelType: 'chat',
          priority: 0,
        },
      ],
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    }).map((row) => ({ ...row, pricingMultiplier: 1.4 }));

    expect(buildPricingRulesFromRows(rows)).toEqual([
      {
        group: 'pro',
        model: 'gpt-4o-mini',
        multiplier: 1.4,
        provider: 'newapi',
      },
    ]);
  });

  it('matches and serializes provider-type and single-instance pricing rules', () => {
    const rows = buildMatrixRows({
      models: [
        {
          displayName: 'DeepSeek Chat',
          groupKey: 'pro',
          groupName: 'Pro Group',
          instanceId: 'inst-deepseek',
          instanceName: 'DeepSeek Gateway',
          modelId: 'deepseek-chat',
          modelType: 'chat',
          priority: 0,
          providerType: 'deepseek',
        },
      ],
      plans,
      planRulesByPlan: {},
      pricingRules: [
        {
          instanceId: 'inst-deepseek',
          model: 'deepseek-chat',
          multiplier: 1.8,
          provider: 'newapi',
          providerType: 'deepseek',
        },
      ],
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        instanceIds: ['inst-deepseek'],
        pricingMultiplier: 1.8,
        providerType: 'deepseek',
        providerTypes: ['deepseek'],
      }),
    );
    expect(buildPricingRulesFromRows(rows)).toEqual([
      {
        group: 'pro',
        instanceId: 'inst-deepseek',
        model: 'deepseek-chat',
        multiplier: 1.8,
        provider: 'newapi',
        providerType: 'deepseek',
      },
    ]);
  });

  it('detects when the current default chat model is disabled for the Free plan', () => {
    const rows = buildMatrixRows({
      defaultModel: 'deepseek-chat',
      defaultProvider: 'newapi',
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });
    const nextRows = togglePlanAccess(rows, 'newapi:chat:deepseek-chat', 'free', false);

    expect(findFreePlanDefaultModelConflict(nextRows)).toEqual({
      displayName: 'DeepSeek Chat',
      modelId: 'deepseek-chat',
      modelType: 'chat',
      provider: 'newapi',
    });
  });

  it('does not report a default conflict when at least one matching group is available to Free', () => {
    const rows = buildMatrixRows({
      defaultModel: 'gpt-4o-mini',
      defaultProvider: 'newapi',
      models: [
        {
          displayName: 'GPT Basic',
          groupKey: 'basic',
          groupName: 'Basic Group',
          instanceId: 'inst-basic',
          instanceName: 'Basic Gateway',
          modelId: 'gpt-4o-mini',
          modelType: 'chat',
          priority: 0,
        },
        {
          displayName: 'GPT Pro',
          groupKey: 'pro',
          groupName: 'Pro Group',
          instanceId: 'inst-pro',
          instanceName: 'Pro Gateway',
          modelId: 'gpt-4o-mini',
          modelType: 'chat',
          priority: 0,
        },
      ],
      plans,
      planRulesByPlan: {
        free: { chat: { allowlist: ['basic:gpt-4o-mini'], mode: 'allowlist' } },
      },
      pricingRules: [],
    });

    expect(findFreePlanDefaultModelConflict(rows)).toBeNull();
    expect(
      getDefaultModelHealth(rows, {
        chat: { model: 'gpt-4o-mini', provider: 'newapi' },
      }).chat,
    ).toEqual(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        status: 'ok',
      }),
    );
  });

  it('detects when the current default image model is disabled for the Free plan', () => {
    const rows = buildMatrixRows({
      defaultModelsByType: {
        image: { model: 'flux-kontext', provider: 'newapi' },
      },
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });
    const nextRows = togglePlanAccess(rows, 'newapi:image:flux-kontext', 'free', false);

    expect(findFreePlanDefaultModelConflict(nextRows)).toEqual({
      displayName: 'flux-kontext',
      modelId: 'flux-kontext',
      modelType: 'image',
      provider: 'newapi',
    });
  });

  it('reports default model health for configured chat/image/video defaults', () => {
    const rows = buildMatrixRows({
      defaultModel: 'deepseek-chat',
      defaultModelsByType: {
        image: { model: 'flux-kontext', provider: 'newapi' },
        video: { model: 'veo-3', provider: 'newapi' },
      },
      defaultProvider: 'newapi',
      models: [
        ...models,
        {
          displayName: 'Veo 3',
          instanceId: 'inst-video',
          instanceName: 'Video Gateway',
          modelId: 'veo-3',
          modelType: 'video' as const,
          priority: 0,
        },
      ],
      plans,
      planRulesByPlan: {
        free: { video: { blocklist: ['veo-3'], mode: 'blocklist' } },
      },
      pricingRules: [],
    });

    expect(
      getDefaultModelHealth(rows, {
        chat: { model: 'deepseek-chat', provider: 'newapi' },
        image: { model: 'flux-kontext', provider: 'newapi' },
        video: { model: 'veo-3', provider: 'newapi' },
      }),
    ).toEqual({
      chat: expect.objectContaining({
        displayName: 'DeepSeek Chat',
        model: 'deepseek-chat',
        provider: 'newapi',
        status: 'ok',
      }),
      image: expect.objectContaining({
        displayName: 'flux-kontext',
        model: 'flux-kontext',
        provider: 'newapi',
        status: 'ok',
      }),
      video: expect.objectContaining({
        displayName: 'Veo 3',
        model: 'veo-3',
        provider: 'newapi',
        status: 'denied_by_free_plan',
      }),
    });
  });

  it('reports missing, disabled, and type-mismatched default models', () => {
    const rows = buildMatrixRows({
      models,
      plans,
      planRulesByPlan: {},
      pricingRules: [],
    });

    expect(
      getDefaultModelHealth(rows, {
        chat: { model: '', provider: 'newapi' },
        image: { model: 'deepseek-chat', provider: 'newapi' },
        video: { model: 'veo-3', provider: 'newapi' },
      }),
    ).toEqual({
      chat: expect.objectContaining({
        provider: 'newapi',
        status: 'not_configured',
      }),
      image: expect.objectContaining({
        actualModelType: 'chat',
        model: 'deepseek-chat',
        provider: 'newapi',
        status: 'type_mismatch',
      }),
      video: expect.objectContaining({
        model: 'veo-3',
        provider: 'newapi',
        status: 'not_enabled',
      }),
    });
  });

  it('summarizes matrix configuration health risks', () => {
    const rows = buildMatrixRows({
      defaultModel: 'deepseek-chat',
      defaultProvider: 'newapi',
      models,
      plans,
      planRulesByPlan: {
        free: {
          chat: { allowlist: ['deepseek-chat'], mode: 'allowlist' },
          image: { allowlist: [], mode: 'allowlist' },
        },
        starter: {
          chat: { allowlist: [], mode: 'allowlist' },
          image: { allowlist: [], mode: 'allowlist' },
        },
      },
      pricingRules: [{ model: 'deepseek-chat', multiplier: 0.8, provider: 'newapi' }],
    });
    const health = getMatrixConfigHealth({
      defaultModelHealth: getDefaultModelHealth(rows, {
        chat: { model: 'deepseek-chat', provider: 'newapi' },
        image: { model: 'flux-kontext', provider: 'newapi' },
        video: { model: 'veo-3', provider: 'newapi' },
      }),
      globalPricingMultiplier: 1,
      plans,
      rows,
    });

    expect(health.status).toBe('error');
    expect(health.summary).toMatchObject({
      blockedModelCount: 1,
      databasePricingModelCount: 0,
      defaultModelIssueCount: 2,
      missingAbilityModelCount: 2,
      modelBankPricingModelCount: 0,
      missingPricingModelCount: 1,
      modelCount: 2,
      planCount: 2,
      plansWithoutAccessCount: 1,
      pricingFallbackModelCount: 0,
      pricingOverrideCount: 1,
      providerPricingModelCount: 0,
    });
    expect(health.checks.map((check) => check.key)).toEqual([
      'default-models',
      'plans-without-models',
      'blocked-models',
      'missing-model-pricing',
      'missing-model-abilities',
    ]);
  });

  it('distinguishes pricing overrides, pricing metadata sources, missing pricing, and missing abilities', () => {
    const diagnosticModels: MatrixSourceModel[] = [
      {
        displayName: 'Override Chat',
        hasModelAbilities: true,
        hasModelPricing: true,
        instanceId: 'inst-override',
        instanceName: 'Override Gateway',
        modelId: 'override-chat',
        modelType: 'chat',
        pricingSource: 'database',
        priority: 0,
      },
      {
        displayName: 'Provider Image',
        hasModelAbilities: false,
        hasModelPricing: true,
        instanceId: 'inst-provider',
        instanceName: 'Provider Gateway',
        modelId: 'provider-image',
        modelType: 'image',
        pricingSource: 'model-bank',
        priority: 0,
      },
      {
        displayName: 'Official Chat',
        hasModelAbilities: true,
        hasModelPricing: true,
        instanceId: 'inst-official',
        instanceName: 'LobeHub Official Gateway',
        modelId: 'official-chat',
        modelType: 'chat',
        pricingSource: 'lobehub-official',
        priority: 0,
      },
      {
        displayName: 'Database Embedding',
        hasModelAbilities: true,
        hasModelPricing: true,
        instanceId: 'inst-database',
        instanceName: 'Database Gateway',
        modelId: 'database-embedding',
        modelType: 'embedding',
        pricingSource: 'database',
        priority: 0,
      },
      {
        displayName: 'Missing Video',
        hasModelAbilities: false,
        hasModelPricing: false,
        instanceId: 'inst-missing',
        instanceName: 'Missing Gateway',
        modelId: 'missing-video',
        modelType: 'video',
        priority: 0,
      },
    ];
    const rows = buildMatrixRows({
      defaultModel: 'override-chat',
      defaultModelsByType: {
        image: { model: 'provider-image', provider: 'newapi' },
        video: { model: 'missing-video', provider: 'newapi' },
      },
      defaultProvider: 'newapi',
      models: diagnosticModels,
      plans,
      planRulesByPlan: {},
      pricingRules: [{ model: 'override-chat', multiplier: 0.8, provider: 'newapi' }],
    });
    const defaultModelHealth = getDefaultModelHealth(rows, {
      chat: { model: 'override-chat', provider: 'newapi' },
      image: { model: 'provider-image', provider: 'newapi' },
      video: { model: 'missing-video', provider: 'newapi' },
    });
    const health = getMatrixConfigHealth({
      defaultModelHealth,
      globalPricingMultiplier: 1,
      plans,
      rows,
    });

    expect(health.summary).toMatchObject({
      missingAbilityModelCount: 2,
      missingPricingModelCount: 1,
      modelCount: 5,
      databasePricingModelCount: 1,
      lobeHubOfficialPricingModelCount: 1,
      modelBankPricingModelCount: 1,
      pricingFallbackModelCount: 3,
      pricingOverrideCount: 1,
      providerPricingModelCount: 4,
    });
    expect(health.checks.map((check) => check.key)).toEqual(
      expect.arrayContaining([
        'pricing-fallbacks',
        'missing-model-pricing',
        'missing-model-abilities',
      ]),
    );
    expect(health.checks.find((check) => check.key === 'pricing-fallbacks')).toMatchObject({
      count: 3,
      severity: 'info',
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'pricing-fallbacks',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: [
        'newapi:chat:official-chat',
        'newapi:embedding:database-embedding',
        'newapi:image:provider-image',
      ],
    });
    expect(rows.map((row) => [row.modelId, row.effectivePricingSource])).toEqual(
      expect.arrayContaining([
        ['override-chat', 'manual-override'],
        ['official-chat', 'lobehub-official'],
        ['provider-image', 'model-bank'],
        ['database-embedding', 'database'],
        ['missing-video', 'missing'],
      ]),
    );
    expect(health.checks.find((check) => check.key === 'missing-model-pricing')).toMatchObject({
      count: 1,
      severity: 'error',
      title: 'Models without reliable pricing are blocked from platform billing',
    });
    expect(health.checks.find((check) => check.key === 'missing-model-abilities')).toMatchObject({
      count: 2,
      severity: 'info',
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'missing-model-pricing',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: ['newapi:video:missing-video'],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'missing-model-abilities',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: ['newapi:image:provider-image', 'newapi:video:missing-video'],
    });
  });

  it('finds matrix rows and plans related to health checks', () => {
    const rows = buildMatrixRows({
      defaultModel: 'deepseek-chat',
      defaultProvider: 'newapi',
      models,
      plans,
      planRulesByPlan: {
        free: {
          chat: { allowlist: ['deepseek-chat'], mode: 'allowlist' },
          image: { allowlist: [], mode: 'allowlist' },
        },
        starter: {
          chat: { allowlist: [], mode: 'allowlist' },
          image: { allowlist: [], mode: 'allowlist' },
        },
      },
      pricingRules: [{ model: 'deepseek-chat', multiplier: 0.8, provider: 'newapi' }],
    });
    const defaultModelHealth = getDefaultModelHealth(rows, {
      chat: { model: 'deepseek-chat', provider: 'newapi' },
      image: { model: 'flux-kontext', provider: 'newapi' },
      video: { model: 'veo-3', provider: 'newapi' },
    });

    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'plans-without-models',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: ['starter'],
      rowKeys: ['newapi:chat:deepseek-chat', 'newapi:image:flux-kontext'],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'blocked-models',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: ['free', 'starter'],
      rowKeys: ['newapi:image:flux-kontext'],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'pricing-fallbacks',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: [],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'missing-model-pricing',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: ['newapi:image:flux-kontext'],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'missing-model-abilities',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: [],
      rowKeys: ['newapi:chat:deepseek-chat', 'newapi:image:flux-kontext'],
    });
    expect(
      getMatrixConfigHealthFocus({
        checkKey: 'default-models',
        defaultModelHealth,
        plans,
        rows,
      }),
    ).toEqual({
      planKeys: ['free'],
      rowKeys: ['newapi:image:flux-kontext'],
    });
  });
});
