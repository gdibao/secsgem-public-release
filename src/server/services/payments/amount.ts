export const parseCnyPaymentAmount = (value: string) => {
  const amount = Number(value);
  const fen = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(fen) ||
    Math.abs(amount * 100 - fen) > 0.000_001
  ) {
    throw new Error('PAYMENT_AMOUNT_PRECISION_UNSUPPORTED');
  }

  return { decimal: (fen / 100).toFixed(2), fen };
};

export const formatCnyPaymentAmountFromFen = (value: unknown) => {
  const fen = Number(value);
  if (!Number.isSafeInteger(fen) || fen <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');
  return (fen / 100).toFixed(6);
};
