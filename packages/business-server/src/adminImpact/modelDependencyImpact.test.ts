import { describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';

import {
  type AdminModelDependencyRoute,
  analyzeModelDependencyImpact,
} from './modelDependencyImpact';

const route = (overrides: Partial<AdminModelDependencyRoute> = {}): AdminModelDependencyRoute => ({
  enabled: true,
  groupKey: 'pro',
  instanceEnabled: true,
  instanceId: 'instance-1',
  instanceName: 'Primary',
  modelId: 'gpt-4o',
  modelType: 'chat',
  providerId: 'newapi-instance-1',
  providerType: 'newapi',
  ...overrides,
});

describe('model dependency impact', () => {
  it('reports system defaults, plan rules, pricing rules, and fallback references', () => {
    const impact = analyzeModelDependencyImpact({
      planRules: [
        {
          modelRules: { chat: { allowlist: ['pro:gpt-*'], mode: 'allowlist' } },
          plan: 'premium',
        },
      ],
      routes: [route()],
      settings: {
        [APP_SETTING_KEYS.defaultAgentModel]: 'gpt-4o',
        [APP_SETTING_KEYS.defaultAgentProvider]: 'newapi',
        [APP_SETTING_KEYS.modelPolicyDefaultModelFallback]: 'gpt-4o',
        [APP_SETTING_KEYS.pricingModelRules]: [
          { group: 'pro', instanceId: 'instance-1', model: 'gpt-4o' },
        ],
      },
      target: {
        instanceId: 'instance-1',
        kind: 'model',
        modelId: 'gpt-4o',
        modelType: 'chat',
      },
      targetExists: true,
    });

    expect(impact.canProceed).toBe(false);
    expect(impact.blocking.map((item) => item.code)).toEqual([
      'SYSTEM_DEFAULT_MODEL_REFERENCE',
      'PLAN_MODEL_RULE_REFERENCE',
      'PRICING_RULE_REFERENCE',
      'MODEL_FALLBACK_REFERENCE',
    ]);
  });

  it('keeps default and fallback references live when an alternate enabled route remains', () => {
    const impact = analyzeModelDependencyImpact({
      planRules: [],
      routes: [route(), route({ instanceId: 'instance-2', instanceName: 'Backup' })],
      settings: {
        [APP_SETTING_KEYS.defaultAgentModel]: 'gpt-4o',
        [APP_SETTING_KEYS.defaultAgentProvider]: 'newapi',
        [APP_SETTING_KEYS.modelPolicyDefaultModelFallback]: 'gpt-4o',
      },
      target: {
        instanceId: 'instance-1',
        kind: 'model',
        modelId: 'gpt-4o',
        modelType: 'chat',
      },
      targetExists: true,
    });

    expect(impact.canProceed).toBe(true);
    expect(impact.blocking).toEqual([]);
    expect(impact.liveEffects).toEqual([
      expect.objectContaining({ code: 'MODEL_RUNTIME_ROUTES_REFRESH', count: 1 }),
    ]);
  });
});
