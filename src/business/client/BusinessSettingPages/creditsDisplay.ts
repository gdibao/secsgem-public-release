export type LedgerAllocationDisplayRecord = {
  metadata?: {
    allocations?: unknown;
  } | null;
  type?: string;
};

export type LedgerAllocationDisplayItem = {
  amount: number;
  source: string;
};

export const getNextCreditLedgerCursor = (page?: { nextCursor?: string | null }) =>
  page?.nextCursor ?? null;

export const normalizeLedgerAllocations = (
  record: LedgerAllocationDisplayRecord,
): LedgerAllocationDisplayItem[] => {
  if (record.type !== 'consume') return [];

  const allocations = record.metadata?.allocations;
  if (!Array.isArray(allocations) || allocations.length === 0) return [];

  return allocations.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];

    const amount = (item as { amount?: unknown }).amount;
    const source = (item as { source?: unknown }).source;

    if (typeof amount !== 'number' || !Number.isFinite(amount)) return [];
    if (typeof source !== 'string' || !source.trim()) return [];

    return [{ amount, source: source.trim() }];
  });
};

export const formatLedgerAllocationText = (
  record: LedgerAllocationDisplayRecord,
  getSourceLabel: (source: string) => string,
  formatAmount: (amount: number) => string,
  options: {
    prefix?: string;
    separator?: string;
  } = {},
) => {
  const allocations = normalizeLedgerAllocations(record);
  if (allocations.length === 0) return null;

  const prefix = options.prefix ?? '扣费来源：';
  const separator = options.separator ?? ' · ';

  return `${prefix}${allocations
    .map((item) => `${getSourceLabel(item.source)} ${formatAmount(item.amount)}`)
    .join(separator)}`;
};
