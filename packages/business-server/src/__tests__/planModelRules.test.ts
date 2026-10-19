// @vitest-environment node
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { planCatalog, userPlanSnapshots, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  assertPlanModelAllowed,
  isModelAllowedByPlanRules,
  resolvePlanModelRules,
} from '../planModelRules';

const serverDB: LobeChatDatabase = await getTestDB();
const expiryUserId = 'plan-model-rules-expired-user';
const deniedUserId = 'plan-model-rules-denied-user';

afterEach(async () => {
  await serverDB.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, expiryUserId));
  await serverDB.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, deniedUserId));
  await serverDB.delete(planCatalog).where(eq(planCatalog.plan, Plans.Free));
  await serverDB.delete(planCatalog).where(eq(planCatalog.plan, Plans.Starter));
  await serverDB.delete(users).where(eq(users.id, expiryUserId));
  await serverDB.delete(users).where(eq(users.id, deniedUserId));
});

describe('plan model rules', () => {
  it('allows exact group-qualified model entries', () => {
    const rules = {
      chat: {
        allowlist: ['pro:gpt-4o'],
        mode: 'allowlist' as const,
      },
    };

    expect(isModelAllowedByPlanRules(rules, 'gpt-4o', 'chat', 'pro')).toBe(true);
    expect(isModelAllowedByPlanRules(rules, 'gpt-4o', 'chat', 'default')).toBe(false);
  });

  it('supports group and model wildcards in qualified entries', () => {
    expect(
      isModelAllowedByPlanRules(
        { chat: { allowlist: ['*:gpt-4o'], mode: 'allowlist' } },
        'gpt-4o',
        'chat',
        'vip',
      ),
    ).toBe(true);

    expect(
      isModelAllowedByPlanRules(
        { chat: { allowlist: ['pro:*'], mode: 'allowlist' } },
        'claude-3-5-sonnet',
        'chat',
        'pro',
      ),
    ).toBe(true);
  });

  it('keeps legacy unqualified model entries working', () => {
    const rules = {
      chat: {
        allowlist: ['gpt-4o'],
        mode: 'allowlist' as const,
      },
    };

    expect(isModelAllowedByPlanRules(rules, 'gpt-4o', 'chat', 'pro')).toBe(true);
  });

  it('allows group-qualified allowlist entries when no group context is available', () => {
    const rules = {
      chat: {
        allowlist: ['basic:gpt-4o-mini'],
        mode: 'allowlist' as const,
      },
    };

    expect(isModelAllowedByPlanRules(rules, 'gpt-4o-mini', 'chat')).toBe(true);
  });

  it('blocks only matching group-qualified entries in blocklist mode', () => {
    const rules = {
      chat: {
        blocklist: ['pro:gpt-4o'],
        mode: 'blocklist' as const,
      },
    };

    expect(isModelAllowedByPlanRules(rules, 'gpt-4o', 'chat', 'pro')).toBe(false);
    expect(isModelAllowedByPlanRules(rules, 'gpt-4o', 'chat', 'vip')).toBe(true);
  });

  it('applies legacy stt plan rules to normalized asr model types', () => {
    const rules = {
      stt: {
        allowlist: ['whisper-1'],
        mode: 'allowlist' as const,
      },
    };

    expect(isModelAllowedByPlanRules(rules, 'whisper-1', 'asr')).toBe(true);
    expect(isModelAllowedByPlanRules(rules, 'gpt-4o-transcribe', 'asr')).toBe(false);
  });

  it('throws a readable Chinese error when the current plan denies a model', async () => {
    await serverDB.insert(users).values([{ id: deniedUserId }]);
    await serverDB.insert(planCatalog).values({
      displayName: 'Free',
      modelRules: { chat: { allowlist: ['free-chat'], mode: 'allowlist' } },
      monthlyCredits: 0,
      monthlyPrice: 0,
      plan: Plans.Free,
    });
    await serverDB.insert(userPlanSnapshots).values({
      cycle: 'monthly',
      monthlyCredits: 0,
      monthlyPrice: 0,
      plan: Plans.Free,
      provider: 'system_default',
      startedAt: new Date('2024-01-01T00:00:00.000Z'),
      status: 'active',
      userId: deniedUserId,
    });

    await expect(
      assertPlanModelAllowed({
        db: serverDB,
        model: 'gpt-4o',
        modelType: 'chat',
        userId: deniedUserId,
      }),
    ).rejects.toMatchObject({
      error: {
        message: '当前套餐未授权使用模型 gpt-4o，请升级套餐或选择其他模型。',
        model: 'gpt-4o',
        modelType: 'chat',
        plan: Plans.Free,
        reason: 'PLAN_MODEL_RULE_DENIED',
      },
    });
  });

  it('falls back to free plan rules when the latest active paid snapshot has expired', async () => {
    await serverDB.insert(users).values([{ id: expiryUserId }]);
    await serverDB.insert(planCatalog).values([
      {
        displayName: 'Free',
        modelRules: { chat: { allowlist: ['free-chat'], mode: 'allowlist' } },
        monthlyCredits: 0,
        monthlyPrice: 0,
        plan: Plans.Free,
      },
      {
        displayName: 'Starter',
        modelRules: { chat: { allowlist: ['paid-chat'], mode: 'allowlist' } },
        monthlyCredits: 100,
        monthlyPrice: 68,
        plan: Plans.Starter,
      },
    ]);
    await serverDB.insert(userPlanSnapshots).values({
      cycle: 'monthly',
      endsAt: new Date('2020-01-01T00:00:00.000Z'),
      monthlyCredits: 100,
      monthlyPrice: 68,
      plan: Plans.Starter,
      provider: 'admin_manual',
      startedAt: new Date('2019-12-01T00:00:00.000Z'),
      status: 'active',
      userId: expiryUserId,
    });

    await expect(resolvePlanModelRules({ db: serverDB, userId: expiryUserId })).resolves.toEqual({
      chat: { allowlist: ['free-chat'], mode: 'allowlist' },
    });

    const unchangedSnapshot = await serverDB.query.userPlanSnapshots.findFirst({
      where: eq(userPlanSnapshots.userId, expiryUserId),
      orderBy: (snapshots, { desc }) => [desc(snapshots.startedAt)],
    });
    expect(unchangedSnapshot).toMatchObject({
      plan: Plans.Starter,
      status: 'active',
    });
  });

  it('uses frozen model rules after the plan catalog changes', async () => {
    await serverDB.insert(users).values([{ id: deniedUserId }]);
    await serverDB.insert(planCatalog).values({
      displayName: 'Starter',
      modelRules: { chat: { allowlist: ['new-chat'], mode: 'allowlist' } },
      monthlyCredits: 100,
      monthlyPrice: 68,
      plan: Plans.Starter,
    });
    await serverDB.insert(userPlanSnapshots).values({
      cycle: 'monthly',
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      metadata: {
        entitlementSnapshot: {
          catalogUpdatedAt: new Date().toISOString(),
          features: [],
          modelRules: { chat: { allowlist: ['purchased-chat'], mode: 'allowlist' } },
          planMetadata: null,
          pptCreditCost: 0,
          pptEnabled: false,
          pptMonthlyQuota: null,
          storageQuotaBytes: null,
          vectorQuota: null,
          version: 2,
        },
      },
      monthlyCredits: 100,
      monthlyPrice: 68,
      plan: Plans.Starter,
      provider: 'alipay',
      startedAt: new Date(),
      status: 'active',
      userId: deniedUserId,
    });

    await expect(resolvePlanModelRules({ db: serverDB, userId: deniedUserId })).resolves.toEqual({
      chat: { allowlist: ['purchased-chat'], mode: 'allowlist' },
    });
  });
});
