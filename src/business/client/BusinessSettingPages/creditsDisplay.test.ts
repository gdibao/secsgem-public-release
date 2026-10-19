import { describe, expect, it } from 'vitest';

import {
  formatLedgerAllocationText,
  getNextCreditLedgerCursor,
  normalizeLedgerAllocations,
} from './creditsDisplay';

const labelSource = (source: string) => `source:${source}`;
const formatAmount = (amount: number) => `${amount} credits`;

describe('credits display helpers', () => {
  it('normalizes valid consume ledger allocations', () => {
    expect(
      normalizeLedgerAllocations({
        metadata: {
          allocations: [
            { amount: 100, source: 'subscription' },
            { amount: 20, source: 'topup' },
          ],
        },
        type: 'consume',
      }),
    ).toEqual([
      { amount: 100, source: 'subscription' },
      { amount: 20, source: 'topup' },
    ]);
  });

  it('ignores malformed or non-consume ledger allocations', () => {
    expect(
      normalizeLedgerAllocations({
        metadata: {
          allocations: [
            null,
            { amount: '100', source: 'subscription' },
            { amount: 1, source: '' },
            { amount: Number.NaN, source: 'topup' },
          ],
        },
        type: 'consume',
      }),
    ).toEqual([]);

    expect(
      normalizeLedgerAllocations({
        metadata: { allocations: [{ amount: 100, source: 'subscription' }] },
        type: 'topup',
      }),
    ).toEqual([]);
  });

  it('formats ledger allocation text with injected source and amount formatters', () => {
    expect(
      formatLedgerAllocationText(
        {
          metadata: {
            allocations: [
              { amount: 100, source: 'subscription' },
              { amount: 20, source: 'topup' },
            ],
          },
          type: 'consume',
        },
        labelSource,
        formatAmount,
        { prefix: 'Used: ', separator: ' | ' },
      ),
    ).toBe('Used: source:subscription 100 credits | source:topup 20 credits');
  });

  it('returns null when no readable allocation can be formatted', () => {
    expect(
      formatLedgerAllocationText(
        { metadata: { allocations: [{ amount: 'bad', source: 'topup' }] }, type: 'consume' },
        labelSource,
        formatAmount,
      ),
    ).toBeNull();
  });

  it('preserves the server cursor for loading the next ledger page', () => {
    expect(getNextCreditLedgerCursor({ nextCursor: 'ledger-page-2' })).toBe('ledger-page-2');
    expect(getNextCreditLedgerCursor({ nextCursor: undefined })).toBeNull();
  });
});
