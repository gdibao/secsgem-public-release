export type PlanPurchaseLike = {
  purchaseUrl?: string | null;
};

export type PlanPurchaseAction =
  { type: 'checkout' } | { type: 'external'; url: string } | { type: 'unavailable' };

export const getPlanPurchaseUrl = (plan?: PlanPurchaseLike | null) => {
  const raw = typeof plan?.purchaseUrl === 'string' ? plan.purchaseUrl.trim() : '';
  if (!raw) return null;

  try {
    const url = new URL(raw);

    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
};

export const resolvePlanPurchaseAction = ({
  hasOnlinePaymentMethods,
  plan,
}: {
  hasOnlinePaymentMethods: boolean;
  plan?: PlanPurchaseLike | null;
}): PlanPurchaseAction => {
  if (hasOnlinePaymentMethods) return { type: 'checkout' };

  const url = getPlanPurchaseUrl(plan);
  return url ? { type: 'external', url } : { type: 'unavailable' };
};
