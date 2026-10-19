// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ModuleAppCreditModel } from '@/database/models/moduleAppCredit';
import { creditAccounts, creditLedgerEntries, creditReservations, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { runModuleAppAction } from './runModuleAppAction';

const APP_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = 'module-app-action-credit-user';
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(creditReservations);
  await serverDB.delete(creditLedgerEntries);
  await serverDB.delete(creditAccounts);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
  await serverDB.insert(creditAccounts).values({
    balance: 100,
    totalCredited: 100,
    userId: USER_ID,
  });
});

describe('runModuleAppAction credit settlement', () => {
  it('keeps persisted non-AI charged credits equal to the real ledger debit', async () => {
    const model = {
      createRun: vi.fn().mockResolvedValue({ id: crypto.randomUUID() }),
      updateRun: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await runModuleAppAction({
      action: {
        id: 'lookup',
        inputSchema: { fields: [] },
        moduleMultiplier: 1,
        name: 'Lookup',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'api_action',
      },
      appId: APP_ID,
      assertEntitlement: vi.fn(),
      billing: {
        chargeMode: 'external_api',
        defaultMultiplier: 1,
        externalApiCostCredits: 7,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 5,
      },
      creditAdapter: new ModuleAppCreditModel(serverDB),
      input: {},
      model: model as never,
      runner: vi.fn().mockResolvedValue({ output: { ok: true }, preview: 'done' }),
      scopeType: 'personal',
      userId: USER_ID,
    });

    expect(result.billing).toMatchObject({ chargedCredits: 7, fixedServiceFeeCharged: false });
    await expect(
      serverDB.query.creditAccounts.findFirst({ where: eq(creditAccounts.userId, USER_ID) }),
    ).resolves.toMatchObject({ balance: 93, totalDebited: 7 });
    await expect(
      serverDB.query.creditLedgerEntries.findMany({
        where: eq(creditLedgerEntries.userId, USER_ID),
      }),
    ).resolves.toHaveLength(1);
    await expect(serverDB.query.creditReservations.findFirst()).resolves.toMatchObject({
      actualAmount: 7,
      releasedAmount: 0,
      status: 'settled',
    });
  });
});
