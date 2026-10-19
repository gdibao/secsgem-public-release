import { randomUUID } from 'node:crypto';

import { Plans } from '@lobechat/types';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { eq, or } from 'drizzle-orm';

type ScenarioKey = 'budget-blocked' | 'credit-mix' | 'free-reset' | 'starter-ready';

const CREDITS_PER_DOLLAR = 1_000_000;
const DEFAULT_SCENARIO: ScenarioKey = 'budget-blocked';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const PLAN_MONTHLY_CREDITS: Record<Plans, number> = {
  [Plans.Free]: 0,
  [Plans.Hobby]: 0,
  [Plans.Premium]: 2200 * CREDITS_PER_DOLLAR,
  [Plans.Starter]: 600 * CREDITS_PER_DOLLAR,
  [Plans.Ultimate]: 7200 * CREDITS_PER_DOLLAR,
};

const formatCredits = (value: number) => {
  const displayValue = value / CREDITS_PER_DOLLAR;

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(displayValue) >= 1 ? 2 : 6,
  }).format(displayValue)} M`;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const help = args.includes('--help') || args.includes('-h');
  const rawScenario = getArg('--scenario');
  const scenario = (rawScenario || DEFAULT_SCENARIO) as ScenarioKey;
  const user = getArg('--user');

  return { help, scenario, user };
};

const printHelp = () => {
  console.log(`
Usage:
  pnpm commercial:seed -- --user <userId|email|username> [--scenario budget-blocked|starter-ready|credit-mix|free-reset]

Examples:
  pnpm commercial:seed -- --user demo@example.com
  pnpm commercial:seed -- --user demo@example.com --scenario credit-mix
`);
};

const normalizeReferralCode = (value: string) => {
  const normalized = value.replaceAll(/\W/g, '').toUpperCase().slice(0, 8);

  return normalized.length >= 2 ? normalized : 'COMHUB';
};

const createSyntheticUserId = (userId: string, suffix: string) =>
  `commercial-seed:${userId}:${suffix}`;

const createSyntheticEmail = (userId: string, suffix: string) =>
  `${userId.replaceAll(/[^a-z0-9]/gi, '').slice(0, 24) || 'comhub'}+${suffix}@seed.local`;

const assertScenario: (value: string) => asserts value is ScenarioKey = (value) => {
  if (
    value !== 'budget-blocked' &&
    value !== 'starter-ready' &&
    value !== 'credit-mix' &&
    value !== 'free-reset'
  ) {
    throw new Error(`Unsupported scenario: ${value}`);
  }
};

const run = async () => {
  const { help, scenario, user } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  if (!user) {
    printHelp();
    throw new Error('Missing required --user argument');
  }

  assertScenario(scenario);

  const { serverDB } = await import('../packages/database/src/server');
  const { CommercialModel } = await import('../packages/database/src/models/commercial');
  const { creditAccounts } = await import('../packages/database/src/schemas/commercial');
  const {
    autoTopUpSettings,
    creditLedgerEntries,
    referralProfiles,
    referralRelations,
    referralRewards,
    subscriptionChangeRequests,
    topUpOrders,
    userPlanSnapshots,
  } = await import('../packages/database/src/schemas/commercial');
  const { users } = await import('../packages/database/src/schemas/user');

  const isEmailLookup = user.includes('@');
  const matchedUser = await serverDB.query.users.findFirst({
    where: isEmailLookup
      ? or(eq(users.email, user), eq(users.normalizedEmail, user.toLowerCase()))
      : or(eq(users.id, user), eq(users.username, user)),
  });

  if (!matchedUser) {
    throw new Error(`User not found: ${user}`);
  }

  const primaryUserId = matchedUser.id;
  const now = new Date();
  const referralCode = normalizeReferralCode(
    matchedUser.username || matchedUser.fullName || matchedUser.email || matchedUser.id,
  );
  const syntheticInviteeId = createSyntheticUserId(primaryUserId, 'invitee');
  const syntheticInviteeEmail = createSyntheticEmail(primaryUserId, 'invitee');

  await serverDB.transaction(async (tx) => {
    const relatedRelations = await tx
      .select({ id: referralRelations.id })
      .from(referralRelations)
      .where(
        or(
          eq(referralRelations.inviterUserId, primaryUserId),
          eq(referralRelations.inviteeUserId, primaryUserId),
        ),
      );

    const relationIds = relatedRelations.map((item) => item.id);

    if (relationIds.length > 0) {
      await tx
        .delete(referralRewards)
        .where(
          or(
            eq(referralRewards.rewardUserId, primaryUserId),
            ...relationIds.map((relationId) => eq(referralRewards.relationId, relationId)),
          ),
        );
    } else {
      await tx.delete(referralRewards).where(eq(referralRewards.rewardUserId, primaryUserId));
    }

    await tx
      .delete(referralRelations)
      .where(
        or(
          eq(referralRelations.inviterUserId, primaryUserId),
          eq(referralRelations.inviteeUserId, primaryUserId),
        ),
      );

    await tx.delete(topUpOrders).where(eq(topUpOrders.userId, primaryUserId));
    await tx.delete(creditLedgerEntries).where(eq(creditLedgerEntries.userId, primaryUserId));
    await tx.delete(autoTopUpSettings).where(eq(autoTopUpSettings.userId, primaryUserId));
    await tx.delete(creditAccounts).where(eq(creditAccounts.userId, primaryUserId));
    await tx
      .delete(subscriptionChangeRequests)
      .where(eq(subscriptionChangeRequests.userId, primaryUserId));
    await tx.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, primaryUserId));
    await tx.delete(referralProfiles).where(eq(referralProfiles.userId, primaryUserId));

    await tx.delete(users).where(eq(users.id, syntheticInviteeId));

    await tx.insert(referralProfiles).values({
      code: referralCode,
      userId: primaryUserId,
    });

    type LedgerSeed = {
      amount: number;
      description: string;
      metadata?: Record<string, unknown>;
      referenceId?: string;
      referenceType?: string;
      title: string;
      type: 'consume' | 'referral_reward' | 'subscription_grant' | 'topup';
    };

    const ledgerSeeds: LedgerSeed[] = [];
    let creditMixRelationId: string | undefined;
    let autoTopUpSeed:
      | {
          enabled: boolean;
          monthlyLimit: number | null;
          monthlyTopUpAmount: number;
          targetBalance: number;
          threshold: number;
        }
      | undefined;

    if (
      scenario === 'starter-ready' ||
      scenario === 'budget-blocked' ||
      scenario === 'credit-mix'
    ) {
      const [snapshot] = await tx
        .insert(userPlanSnapshots)
        .values({
          currency: 'USD',
          cycle: 'monthly',
          externalSubscriptionId: `seed-${scenario}-${randomUUID()}`,
          metadata: { scenario, seededBy: 'commercial:seed' },
          monthlyCredits:
            scenario === 'credit-mix'
              ? PLAN_MONTHLY_CREDITS[Plans.Premium]
              : PLAN_MONTHLY_CREDITS[Plans.Starter],
          monthlyPrice: scenario === 'credit-mix' ? 59 : 19.9,
          plan: scenario === 'credit-mix' ? Plans.Premium : Plans.Starter,
          provider: 'manual_preview',
          renewsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          startedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          status: 'active',
          userId: primaryUserId,
        })
        .returning({ id: userPlanSnapshots.id, monthlyCredits: userPlanSnapshots.monthlyCredits });

      ledgerSeeds.push({
        amount: Number(snapshot.monthlyCredits),
        description: `Seeded ${scenario === 'credit-mix' ? Plans.Premium : Plans.Starter} subscription credits`,
        metadata: {
          periodIndex: 0,
          periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          plan: scenario === 'credit-mix' ? Plans.Premium : Plans.Starter,
          previewMode: true,
          seededBy: 'commercial:seed',
          snapshotId: snapshot.id,
        },
        referenceId: `${snapshot.id}:0`,
        referenceType: 'subscription_snapshot_period',
        title: 'Subscription Credits',
        type: 'subscription_grant',
      });

      if (scenario === 'budget-blocked') {
        ledgerSeeds.push({
          amount: -(Number(snapshot.monthlyCredits) - 120),
          description: 'Seeded commercial budget exhaustion for chat blocking',
          metadata: {
            allocations: [
              { amount: Number(snapshot.monthlyCredits) - 120, source: 'subscription' },
            ],
            model: 'seed-gpt-budget',
            seededBy: 'commercial:seed',
          },
          referenceId: 'seed-message-budget-blocked',
          referenceType: 'assistant_message',
          title: 'Seeded Chat Usage',
          type: 'consume',
        });
      }

      if (scenario === 'credit-mix') {
        await tx.insert(users).values({
          email: syntheticInviteeEmail,
          emailVerified: true,
          fullName: 'Commercial Seed Invitee',
          id: syntheticInviteeId,
          normalizedEmail: syntheticInviteeEmail.toLowerCase(),
        });

        const [relation] = await tx
          .insert(referralRelations)
          .values({
            code: referralCode,
            inviteeUserId: syntheticInviteeId,
            inviterUserId: primaryUserId,
            rewardCredits: 100 * CREDITS_PER_DOLLAR,
            rewardedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
            status: 'rewarded',
          })
          .returning({ id: referralRelations.id });

        creditMixRelationId = relation.id;

        const [topUpOrder] = await tx
          .insert(topUpOrders)
          .values({
            amount: 27,
            credits: 300 * CREDITS_PER_DOLLAR,
            currency: 'USD',
            metadata: { packageId: 'growth', seededBy: 'commercial:seed', validityMonths: 12 },
            paidAt: new Date(now.getTime() - 90 * 60 * 1000),
            provider: 'manual_preview',
            status: 'paid',
            userId: primaryUserId,
          })
          .returning({ id: topUpOrders.id });

        ledgerSeeds.push(
          {
            amount: 100 * CREDITS_PER_DOLLAR,
            description: 'Seeded referral reward',
            metadata: {
              previewMode: true,
              relationId: relation.id,
              role: 'inviter',
              seededBy: 'commercial:seed',
            },
            referenceId: relation.id,
            referenceType: 'referral_relation',
            title: 'Referral Reward',
            type: 'referral_reward',
          },
          {
            amount: 300 * CREDITS_PER_DOLLAR,
            description: 'Seeded paid top-up order',
            metadata: {
              amount: 27,
              currency: 'USD',
              orderId: topUpOrder.id,
              provider: 'manual_preview',
              seededBy: 'commercial:seed',
            },
            referenceId: topUpOrder.id,
            referenceType: 'top_up_order',
            title: 'Top-up Order',
            type: 'topup',
          },
          {
            amount: -(2_350 * CREDITS_PER_DOLLAR),
            description: 'Seeded mixed-source chat usage',
            metadata: {
              allocations: [
                { amount: 2_200 * CREDITS_PER_DOLLAR, source: 'subscription' },
                { amount: 100 * CREDITS_PER_DOLLAR, source: 'referral' },
                { amount: 50 * CREDITS_PER_DOLLAR, source: 'topup' },
              ],
              model: 'seed-gpt-mix',
              seededBy: 'commercial:seed',
            },
            referenceId: 'seed-message-credit-mix',
            referenceType: 'assistant_message',
            title: 'Seeded Chat Usage',
            type: 'consume',
          },
        );

        autoTopUpSeed = {
          enabled: true,
          monthlyLimit: 500 * CREDITS_PER_DOLLAR,
          monthlyTopUpAmount: 0,
          targetBalance: 900 * CREDITS_PER_DOLLAR,
          threshold: 200 * CREDITS_PER_DOLLAR,
        };
      }
    }

    let balance = 0;
    let totalCredited = 0;
    let totalDebited = 0;
    const insertedLedgerIds = new Map<string, string>();

    for (const seed of ledgerSeeds) {
      balance += seed.amount;
      if (seed.amount >= 0) totalCredited += seed.amount;
      else totalDebited += Math.abs(seed.amount);

      const [entry] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: seed.amount,
          balanceAfter: balance,
          description: seed.description,
          metadata: seed.metadata,
          referenceId: seed.referenceId,
          referenceType: seed.referenceType,
          title: seed.title,
          type: seed.type,
          userId: primaryUserId,
        })
        .returning({ id: creditLedgerEntries.id, referenceId: creditLedgerEntries.referenceId });

      if (entry?.referenceId) insertedLedgerIds.set(entry.referenceId, entry.id);
    }

    await tx.insert(creditAccounts).values({
      balance,
      currency: 'CREDITS',
      totalCredited,
      totalDebited,
      userId: primaryUserId,
    });

    if (scenario === 'credit-mix') {
      const referralLedgerId = creditMixRelationId
        ? insertedLedgerIds.get(creditMixRelationId)
        : undefined;

      if (creditMixRelationId && referralLedgerId) {
        await tx.insert(referralRewards).values({
          amount: 100 * CREDITS_PER_DOLLAR,
          ledgerEntryId: referralLedgerId,
          metadata: { previewMode: true, seededBy: 'commercial:seed' },
          relationId: creditMixRelationId,
          rewardUserId: primaryUserId,
          role: 'inviter',
        });
      }
    }

    if (autoTopUpSeed) {
      await tx.insert(autoTopUpSettings).values({
        ...autoTopUpSeed,
        userId: primaryUserId,
      });
    }
  });

  const commercialModel = new CommercialModel(serverDB, primaryUserId);
  const [overview, referralOverview, topUpHistory] = await Promise.all([
    commercialModel.getCommercialOverview(),
    commercialModel.getReferralOverview(),
    commercialModel.listTopUpOrders({ limit: 5 }),
  ]);

  console.log(`✅ Seeded commercial scenario: ${scenario}`);
  console.log(`User: ${matchedUser.email || matchedUser.username || matchedUser.id}`);
  console.log(`Plan: ${overview.subscription.plan}`);
  console.log(`Balance: ${formatCredits(overview.account.balance)}`);
  console.log(`Credited: ${formatCredits(overview.account.totalCredited)}`);
  console.log(`Used: ${formatCredits(overview.account.totalDebited)}`);
  console.log(`Referral invites: ${referralOverview.totalInvites}`);
  console.log(`Top-up orders: ${topUpHistory.length}`);
};

run().catch((error) => {
  console.error('❌ Failed to seed commercial state');
  console.error(error);
  process.exit(1);
});
