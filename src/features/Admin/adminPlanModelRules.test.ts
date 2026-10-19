import { describe, expect, it } from 'vitest';

import { ADMIN_BASE_PATH } from './adminNavigation';
import {
  ADMIN_PLAN_MODEL_MATRIX_PATH,
  getPlanModelRulesSummary,
  getPlanModelRulesSummaryInfo,
} from './adminPlanModelRules';

describe('adminPlanModelRules', () => {
  it('points plan model permission edits to the shared matrix page', () => {
    expect(ADMIN_PLAN_MODEL_MATRIX_PATH).toBe(`${ADMIN_BASE_PATH}/model-billing-matrix`);
  });

  it('summarizes whether a plan has model permission rules', () => {
    expect(getPlanModelRulesSummary(null)).toBe('默认开放全部已启用模型');
    expect(
      getPlanModelRulesSummary({
        chat: { allowlist: ['deepseek-chat'], mode: 'allowlist' },
        image: { blocklist: ['flux-*'], mode: 'blocklist' },
      }),
    ).toBe('限制 2 类模型');
  });

  it('counts allowlist and blocklist rules for plan model access summaries', () => {
    expect(
      getPlanModelRulesSummaryInfo({
        chat: { allowlist: ['deepseek-chat', 'pro:gpt-*'], mode: 'allowlist' },
        embedding: { allowlist: ['text-embedding-*'], mode: 'allowlist' },
        image: { blocklist: ['flux-*'], mode: 'blocklist' },
      }),
    ).toEqual({
      allowlistEntryCount: 3,
      allowlistTypeCount: 2,
      blocklistEntryCount: 1,
      blocklistTypeCount: 1,
      configuredTypeCount: 3,
      hasRules: true,
      label: '限制 3 类模型',
    });
  });
});
