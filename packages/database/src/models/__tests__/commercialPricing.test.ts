import { DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';
import { describe, expect, it } from 'vitest';

import { parseAiUsagePricingRules, resolveAiUsagePricing } from '../commercial';

describe('resolveAiUsagePricing', () => {
  const rules = [
    { group: 'pro', model: 'gpt-test', multiplier: 2, provider: 'newapi' },
    { model: 'gpt-test', multiplier: 1.2, provider: 'newapi' },
  ];

  it('uses the generic model rule when no route group is present', () => {
    expect(
      resolveAiUsagePricing({
        globalMultiplier: 1,
        model: 'gpt-test',
        provider: 'newapi',
        rules,
      }),
    ).toEqual(
      expect.objectContaining({
        matchedRule: expect.objectContaining({ multiplier: 1.2 }),
        multiplier: 1.2,
      }),
    );
  });

  it('uses the default 35 percent pricing multiplier when no global multiplier is configured', () => {
    expect(
      resolveAiUsagePricing({
        model: 'gpt-test',
        provider: 'newapi',
        rules: [],
      }),
    ).toEqual(
      expect.objectContaining({
        multiplier: DEFAULT_PRICING_CREDIT_MULTIPLIER,
      }),
    );
  });

  it('uses the default 35 percent pricing multiplier when global multiplier is non-positive', () => {
    expect(
      resolveAiUsagePricing({
        globalMultiplier: 0,
        model: 'gpt-test',
        provider: 'newapi',
        rules: [],
      }),
    ).toEqual(
      expect.objectContaining({
        multiplier: DEFAULT_PRICING_CREDIT_MULTIPLIER,
      }),
    );
  });

  it('uses the group-specific rule when route group matches', () => {
    expect(
      resolveAiUsagePricing({
        globalMultiplier: 1,
        groupKey: 'pro',
        model: 'gpt-test',
        provider: 'newapi',
        rules,
      }),
    ).toEqual(
      expect.objectContaining({
        matchedRule: expect.objectContaining({ group: 'pro', multiplier: 2 }),
        multiplier: 2,
      }),
    );
  });

  it('applies the route group multiplier on top of global and model rule multipliers', () => {
    const result = resolveAiUsagePricing({
      globalMultiplier: 1.1,
      groupKey: 'pro',
      groupMultiplier: 1.5,
      model: 'gpt-test',
      provider: 'newapi',
      rules,
    });

    expect(result.matchedRule).toEqual(expect.objectContaining({ group: 'pro', multiplier: 2 }));
    expect(result.multiplier).toBeCloseTo(3.3);
  });

  it('prefers provider-type rules over generic provider rules for admin-routed providers', () => {
    const result = resolveAiUsagePricing({
      globalMultiplier: 1,
      model: 'gpt-test',
      provider: 'newapi',
      providerType: 'deepseek',
      rules: [
        { model: 'gpt-test', multiplier: 1.2, provider: 'newapi' },
        { model: 'gpt-test', multiplier: 1.7, providerType: 'deepseek' },
      ],
    });

    expect(result.matchedRule).toEqual(
      expect.objectContaining({ multiplier: 1.7, providerType: 'deepseek' }),
    );
    expect(result.multiplier).toBe(1.7);
  });

  it('prefers instance-specific rules over provider-type and group rules', () => {
    const result = resolveAiUsagePricing({
      globalMultiplier: 1,
      groupKey: 'pro',
      instanceId: 'instance-vip',
      model: 'gpt-test',
      provider: 'newapi',
      providerType: 'deepseek',
      rules: [
        { group: 'pro', model: 'gpt-test', multiplier: 1.4, provider: 'newapi' },
        { model: 'gpt-test', multiplier: 1.7, providerType: 'deepseek' },
        { instanceId: 'instance-vip', model: 'gpt-test', multiplier: 2.5 },
      ],
    });

    expect(result.matchedRule).toEqual(
      expect.objectContaining({ instanceId: 'instance-vip', multiplier: 2.5 }),
    );
    expect(result.multiplier).toBe(2.5);
  });
});

describe('parseAiUsagePricingRules', () => {
  it('rejects malformed pricing configuration instead of silently disabling all rules', () => {
    expect(() => parseAiUsagePricingRules({ model: 'gpt-test' })).toThrow();
    expect(() => parseAiUsagePricingRules([{ model: 'gpt-test', multiplier: -1 }])).toThrow();
    expect(() =>
      parseAiUsagePricingRules([{ model: 'gpt-test', multiplier: 1, typo: true }]),
    ).toThrow();
  });

  it('accepts an absent setting as an intentionally empty rule set', () => {
    expect(parseAiUsagePricingRules(undefined)).toEqual([]);
  });
});
