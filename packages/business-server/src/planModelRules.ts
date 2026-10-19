import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, Plans, subscriptionEntitlementSnapshotSchema } from '@lobechat/types';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { normalizeAiModelType } from 'model-bank';

import { planCatalog, userPlanSnapshots } from '@/database/schemas';
import { type PlanModelRules } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

export type PlanModelRuleType =
  'chat' | 'embedding' | 'tts' | 'asr' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wildcardMatch = (pattern: string, value: string): boolean => {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  const regexp = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return regexp.test(value);
};

const normalizeGroupKey = (groupKey: string | null | undefined) =>
  groupKey?.trim().toLowerCase() || 'default';

const matchesEntry = (entry: string, model: string, groupKey?: string | null) => {
  const normalized = entry.trim().toLowerCase();
  if (!normalized) return false;

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > -1) {
    const groupPattern = normalized.slice(0, separatorIndex).trim();
    const modelPattern = normalized.slice(separatorIndex + 1).trim();
    if (!groupPattern || !modelPattern) return false;

    return (
      wildcardMatch(groupPattern, normalizeGroupKey(groupKey)) &&
      wildcardMatch(modelPattern, model.toLowerCase())
    );
  }

  return wildcardMatch(normalized, model.toLowerCase());
};

const matchesEntryWithoutGroupContext = (entry: string, model: string) => {
  const normalized = entry.trim().toLowerCase();
  if (!normalized) return false;

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > -1) {
    const modelPattern = normalized.slice(separatorIndex + 1).trim();
    return !!modelPattern && wildcardMatch(modelPattern, model.toLowerCase());
  }

  return wildcardMatch(normalized, model.toLowerCase());
};

const getRuleForModelType = (rules: PlanModelRules, modelType: PlanModelRuleType) => {
  const normalizedModelType = normalizeAiModelType(modelType) as PlanModelRuleType;
  return {
    normalizedModelType,
    rule: rules[normalizedModelType] ?? (normalizedModelType === 'asr' ? rules.stt : undefined),
  };
};

const getEffectivePlanSnapshot = async (db: LobeChatDatabase, userId: string) => {
  const now = new Date();

  const activeSnapshot = await db.query.userPlanSnapshots.findFirst({
    orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
    where: and(
      eq(userPlanSnapshots.userId, userId),
      eq(userPlanSnapshots.status, 'active'),
      or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
    ),
  });

  if (activeSnapshot) return activeSnapshot;

  return { metadata: null, plan: Plans.Free };
};

const resolveSnapshotModelRules = async (
  db: LobeChatDatabase,
  snapshot: Awaited<ReturnType<typeof getEffectivePlanSnapshot>>,
): Promise<PlanModelRules | null> => {
  const metadata =
    snapshot.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
      ? (snapshot.metadata as Record<string, unknown>)
      : null;

  if (metadata && Object.hasOwn(metadata, 'entitlementSnapshot')) {
    const entitlement = subscriptionEntitlementSnapshotSchema.parse(metadata.entitlementSnapshot);
    return entitlement.modelRules as PlanModelRules | null;
  }

  const catalog = await db.query.planCatalog.findFirst({
    where: eq(planCatalog.plan, snapshot.plan),
  });
  return (catalog?.modelRules ?? null) as PlanModelRules | null;
};

interface AssertPlanModelAllowedParams {
  db: LobeChatDatabase;
  groupKey?: string | null;
  model: string | null | undefined;
  modelType?: PlanModelRuleType;
  userId: string;
}

/**
 * Enforce per-plan model rules on top of the global model policy.
 *
 * - No active plan snapshot OR no `modelRules` configured => allow.
 * - Rule for the type missing => allow (per-type opt-in).
 * - mode='allowlist': model must match at least one allowlist entry.
 * - mode='blocklist': model must not match any blocklist entry.
 *
 * Throws a Forbidden ChatError when denied.
 */
export const assertPlanModelAllowed = async ({
  db,
  groupKey,
  model,
  modelType = 'chat',
  userId,
}: AssertPlanModelAllowedParams): Promise<void> => {
  const trimmed = model?.trim();
  if (!trimmed) return;

  const snapshot = await getEffectivePlanSnapshot(db, userId);
  const rules = await resolveSnapshotModelRules(db, snapshot);
  if (!rules) return;

  const { normalizedModelType, rule } = getRuleForModelType(rules, modelType);
  if (!rule) return;

  const matchedAllowlist = (rule.allowlist ?? []).some((e) => matchesEntry(e, trimmed, groupKey));
  const matchedBlocklist = (rule.blocklist ?? []).some((e) => matchesEntry(e, trimmed, groupKey));

  const denied =
    rule.mode === 'allowlist' ? !matchedAllowlist : rule.mode === 'blocklist' && matchedBlocklist;

  if (!denied) return;

  throw AgentRuntimeError.createError(ChatErrorType.Forbidden, {
    message: `当前套餐未授权使用模型 ${trimmed}，请升级套餐或选择其他模型。`,
    model: trimmed,
    modelType: normalizedModelType,
    plan: snapshot.plan,
    reason: 'PLAN_MODEL_RULE_DENIED',
  });
};

interface ResolvePlanModelRulesParams {
  db: LobeChatDatabase;
  userId: string;
}

/**
 * Resolve the user's effective per-type model rules, or null if no plan
 * snapshot exists or no rules are configured for the plan. Pure read — used
 * by both the runtime check and frontend list filtering.
 */
export const resolvePlanModelRules = async ({
  db,
  userId,
}: ResolvePlanModelRulesParams): Promise<PlanModelRules | null> => {
  const snapshot = await getEffectivePlanSnapshot(db, userId);
  return resolveSnapshotModelRules(db, snapshot);
};

/**
 * Apply a PlanModelRules object to a model id of a given type. Returns true
 * when the model is allowed under the rules, or when no rule applies.
 */
export const isModelAllowedByPlanRules = (
  rules: PlanModelRules | null | undefined,
  modelId: string | null | undefined,
  modelType: PlanModelRuleType,
  groupKey?: string | null,
): boolean => {
  const trimmed = modelId?.trim();
  if (!trimmed) return true;
  if (!rules) return true;
  const { rule } = getRuleForModelType(rules, modelType);
  if (!rule) return true;

  const hasGroupContext = typeof groupKey === 'string' && groupKey.trim().length > 0;
  const matchedAllowlist = (rule.allowlist ?? []).some((e) =>
    hasGroupContext
      ? matchesEntry(e, trimmed, groupKey)
      : matchesEntryWithoutGroupContext(e, trimmed),
  );
  const matchedBlocklist = (rule.blocklist ?? []).some((e) => matchesEntry(e, trimmed, groupKey));

  if (rule.mode === 'allowlist') return matchedAllowlist;
  if (rule.mode === 'blocklist') return !matchedBlocklist;
  return true;
};
