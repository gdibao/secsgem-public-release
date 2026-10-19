// @vitest-environment node
import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  appSettings,
  creditAccounts,
  creditLedgerEntries,
  referralProfiles,
  referralRelations,
  referralRewards,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CommercialModel } from '../commercial';

const serverDB: LobeChatDatabase = await getTestDB();
const inviteeUserId = 'referral-settings-invitee';
const inviterUserId = 'referral-settings-inviter';
const referralSettingKey = 'referral.rewardCredits';
const fallbackReward = 100 * CREDITS_PER_DOLLAR;
const configuredReward = 250 * CREDITS_PER_DOLLAR;

const commercialModel = new CommercialModel(serverDB, inviteeUserId);

const cleanup = async () => {
  await serverDB
    .delete(referralRelations)
    .where(eq(referralRelations.inviteeUserId, inviteeUserId));
  await serverDB
    .delete(creditLedgerEntries)
    .where(inArray(creditLedgerEntries.userId, [inviteeUserId, inviterUserId]));
  await serverDB
    .delete(creditAccounts)
    .where(inArray(creditAccounts.userId, [inviteeUserId, inviterUserId]));
  await serverDB
    .delete(referralProfiles)
    .where(inArray(referralProfiles.userId, [inviteeUserId, inviterUserId]));
  await serverDB.delete(appSettings).where(eq(appSettings.key, referralSettingKey));
  await serverDB.delete(users).where(inArray(users.id, [inviteeUserId, inviterUserId]));
};

const setReferralReward = async (value: unknown) => {
  const serialized = JSON.stringify(value);
  await serverDB.execute(sql`
    INSERT INTO app_settings (key, value)
    VALUES (${referralSettingKey}, ${serialized}::jsonb)
    ON CONFLICT (key) DO UPDATE
    SET value = excluded.value, updated_at = now()
  `);
};

const seedRelation = async (rewardCredits: number) => {
  const [relation] = await serverDB
    .insert(referralRelations)
    .values({
      code: '1234567',
      inviteeUserId,
      inviterUserId,
      rewardCredits,
      status: 'registered',
    })
    .returning();

  return relation;
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: inviteeUserId }, { id: inviterUserId }]);
});

afterEach(cleanup);

describe('CommercialModel referral reward setting', () => {
  it('uses one configured positive reward read in the referral overview', async () => {
    await setReferralReward(configuredReward);
    const settingRead = vi.spyOn(serverDB.query.appSettings, 'findFirst');

    const overview = await commercialModel.getReferralOverview();

    expect(overview.rewardCreditsPerInvite).toBe(configuredReward);
    expect(settingRead).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, -1, '250000', { value: configuredReward }])(
    'falls back for invalid configured reward %j',
    async (value) => {
      await setReferralReward(value);

      await expect(commercialModel.getReferralOverview()).resolves.toMatchObject({
        rewardCreditsPerInvite: fallbackReward,
      });
    },
  );

  it('falls back when the referral reward setting is missing', async () => {
    await expect(commercialModel.getReferralOverview()).resolves.toMatchObject({
      rewardCreditsPerInvite: fallbackReward,
    });
  });

  it('uses the configured reward once when activating an unsnapshotted relation', async () => {
    await setReferralReward(configuredReward);
    const relation = await seedRelation(0);
    const settingRead = vi.spyOn(serverDB.query.appSettings, 'findFirst');

    await expect(commercialModel.activateReferralReward()).resolves.toMatchObject({
      id: relation.id,
      rewardCredits: configuredReward,
      status: 'rewarded',
    });
    expect(settingRead).toHaveBeenCalledTimes(1);

    const rewards = await serverDB.query.referralRewards.findMany({
      where: eq(referralRewards.relationId, relation.id),
    });
    expect(rewards).toHaveLength(2);
    expect(rewards.map((reward) => Number(reward.amount))).toEqual([
      configuredReward,
      configuredReward,
    ]);
  });

  it('keeps a positive relation snapshot ahead of the configured reward', async () => {
    const snapshottedReward = 400 * CREDITS_PER_DOLLAR;
    await setReferralReward(configuredReward);
    await seedRelation(snapshottedReward);

    await expect(commercialModel.activateReferralReward()).resolves.toMatchObject({
      rewardCredits: snapshottedReward,
      status: 'rewarded',
    });
  });
});
