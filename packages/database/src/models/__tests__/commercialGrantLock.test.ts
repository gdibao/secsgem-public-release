import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('subscription grant synchronization locking', () => {
  it('locks the credit account before checking existing period grants', () => {
    const source = readFileSync(path.resolve(__dirname, '../commercial.ts'), 'utf8');
    const methodStart = source.indexOf('private syncSubscriptionCreditsForSnapshot');
    const methodEnd = source.indexOf('private syncPlanResourceQuotasForSnapshot', methodStart);
    const method = source.slice(methodStart, methodEnd);

    const lockPosition = method.indexOf('lockCreditAccountForUpdate');
    const existingGrantQueryPosition = method.indexOf('const existingEntries');

    expect(lockPosition).toBeGreaterThanOrEqual(0);
    expect(existingGrantQueryPosition).toBeGreaterThan(lockPosition);
  });

  it('makes every free-plan fallback insert tolerant of the active-plan unique index', () => {
    const slices: Array<[string, string, string]> = [
      [
        path.resolve(__dirname, '../commercial.ts'),
        'private ensureUnlimitedFreePlanSnapshot',
        'private syncLatestSubscriptionCredits',
      ],
      [
        path.resolve(__dirname, '../../../../business-server/src/user.ts'),
        'async function ensureDefaultFreePlanSnapshot',
        '\n}',
      ],
      [
        path.resolve(__dirname, '../../../../business-server/src/planModelRules.ts'),
        'const ensureActivePlanSnapshot',
        'interface AssertPlanModelAllowedParams',
      ],
      [
        path.resolve(__dirname, '../../../../business-server/src/subscriptionMaintenance.ts'),
        'export const syncExpiredSubscriptionsToFree',
        'return {',
      ],
    ];

    for (const [file, startMarker, endMarker] of slices) {
      const source = readFileSync(file, 'utf8');
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start + startMarker.length);
      const fallback = source.slice(start, end > start ? end : undefined);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(fallback).toContain('.onConflictDoNothing()');
    }
  });
});
