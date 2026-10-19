import { ADMIN_BASE_PATH } from './adminNavigation';

export type AdminPlanModelRule = {
  allowlist?: string[];
  blocklist?: string[];
  mode: 'allowlist' | 'blocklist';
};

export type AdminPlanModelRules = Partial<Record<string, AdminPlanModelRule>>;

export const ADMIN_PLAN_MODEL_MATRIX_PATH = `${ADMIN_BASE_PATH}/model-billing-matrix`;

export type AdminPlanModelRulesSummary = {
  allowlistEntryCount: number;
  allowlistTypeCount: number;
  blocklistEntryCount: number;
  blocklistTypeCount: number;
  configuredTypeCount: number;
  hasRules: boolean;
  label: string;
};

export const getPlanModelRulesSummaryInfo = (
  rules?: AdminPlanModelRules | null,
): AdminPlanModelRulesSummary => {
  const configuredRules = Object.values(rules ?? {}).filter(
    (rule): rule is AdminPlanModelRule => Boolean(rule),
  );
  const allowlistRules = configuredRules.filter((rule) => rule.mode === 'allowlist');
  const blocklistRules = configuredRules.filter((rule) => rule.mode === 'blocklist');
  const configuredTypeCount = configuredRules.length;

  if (configuredTypeCount === 0) {
    return {
      allowlistEntryCount: 0,
      allowlistTypeCount: 0,
      blocklistEntryCount: 0,
      blocklistTypeCount: 0,
      configuredTypeCount,
      hasRules: false,
      label: '默认开放全部已启用模型',
    };
  }

  return {
    allowlistEntryCount: allowlistRules.reduce(
      (count, rule) => count + (rule.allowlist?.length ?? 0),
      0,
    ),
    allowlistTypeCount: allowlistRules.length,
    blocklistEntryCount: blocklistRules.reduce(
      (count, rule) => count + (rule.blocklist?.length ?? 0),
      0,
    ),
    blocklistTypeCount: blocklistRules.length,
    configuredTypeCount,
    hasRules: true,
    label: `限制 ${configuredTypeCount} 类模型`,
  };
};

export const getPlanModelRulesSummary = (rules?: AdminPlanModelRules | null) => {
  const summary = getPlanModelRulesSummaryInfo(rules);

  return summary.label;
};
