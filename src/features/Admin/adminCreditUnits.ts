import { toAtomicCredits, toDisplayCredits } from '@lobechat/const/currency';

const normalizeCreditValue = (value: null | number | string | undefined) => {
  const normalized = Number(value ?? 0);

  return Number.isFinite(normalized) ? normalized : 0;
};

export const toAdminAtomicCredits = (displayCredits: null | number | string | undefined) =>
  toAtomicCredits(normalizeCreditValue(displayCredits));

export const toAdminDisplayCredits = (atomicCredits: null | number | string | undefined) =>
  toDisplayCredits(normalizeCreditValue(atomicCredits));

export const formatAdminCredits = (atomicCredits: null | number | string | undefined) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(
    toAdminDisplayCredits(atomicCredits),
  )} M`;
