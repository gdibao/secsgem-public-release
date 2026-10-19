export type PlanCatalogPresentation = {
  badge: string;
  comparisonNote: string;
  pptCreditCost: number;
  pptEnabled: boolean;
  pptMonthlyQuota: null | number;
  storageQuotaMb: null | number;
  vectorQuota: null | number;
  yearlyDiscountLabel: string;
};

export type TopUpPackagePromotion = {
  enabled: boolean;
  label: string;
  note: string;
  originalAmount?: number;
};

export type PlanFaqItem = {
  answer: string;
  enabled: boolean;
  id: string;
  question: string;
};

export const DEFAULT_PLAN_FAQ_ITEMS: PlanFaqItem[] = [
  {
    answer: '可以。免费套餐可使用基础额度；升级后可获得更多积分、容量和高级模型权限。',
    enabled: true,
    id: 'free',
    question: '可以免费使用吗？',
  },
  {
    answer: '积分用于衡量模型调用、生成与部分高级能力的消耗，具体扣费以后台模型与计费矩阵为准。',
    enabled: true,
    id: 'credits',
    question: '什么是积分？',
  },
  {
    answer: '订阅积分会优先消耗，之后使用充值积分。积分不足时可以升级套餐、充值积分或使用兑换码。',
    enabled: true,
    id: 'topup',
    question: '积分用完怎么办？',
  },
  {
    answer: '套餐价格、年付优惠、权益、模型权限和购买链接均由管理员在后台维护。',
    enabled: true,
    id: 'admin',
    question: '套餐权益由哪里配置？',
  },
];

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeNonNegativeNumber = (value: unknown, fallback = 0) => {
  const numeric = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const normalizeNullableNonNegativeNumber = (value: unknown): null | number => {
  if (value === null || value === undefined || value === '') return null;

  const numeric = normalizeNonNegativeNumber(value, Number.NaN);

  return Number.isFinite(numeric) ? numeric : null;
};

export const normalizePlanCatalogPresentation = (metadata: unknown): PlanCatalogPresentation => {
  const source = normalizeObject(metadata);

  return {
    badge: normalizeText(source.badge),
    comparisonNote: normalizeText(source.comparisonNote),
    pptCreditCost: normalizeNonNegativeNumber(source.pptCreditCost),
    pptEnabled: source.pptEnabled === true,
    pptMonthlyQuota: normalizeNullableNonNegativeNumber(source.pptMonthlyQuota),
    storageQuotaMb: normalizeNullableNonNegativeNumber(source.storageQuotaMb),
    vectorQuota: normalizeNullableNonNegativeNumber(source.vectorQuota),
    yearlyDiscountLabel: normalizeText(source.yearlyDiscountLabel),
  };
};

export const normalizeTopUpPackagePromotion = (metadata: unknown): TopUpPackagePromotion => {
  const source = normalizeObject(metadata);
  const originalAmount = normalizeNullableNonNegativeNumber(source.originalAmount);

  return {
    enabled: source.promotionEnabled === true,
    label: normalizeText(source.promotionLabel),
    note: normalizeText(source.promotionNote),
    ...(typeof originalAmount === 'number' ? { originalAmount } : {}),
  };
};

export const serializeTopUpPackagePromotion = (promotion: TopUpPackagePromotion) => ({
  ...(typeof promotion.originalAmount === 'number'
    ? { originalAmount: promotion.originalAmount }
    : {}),
  promotionEnabled: promotion.enabled,
  promotionLabel: promotion.label,
  promotionNote: promotion.note,
});

const normalizeFaqId = (value: unknown, fallback: string) => {
  const text = normalizeText(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  return text || fallback;
};

const normalizePlanFaqRows = (
  value: unknown,
  { includeDisabled }: { includeDisabled: boolean },
): PlanFaqItem[] => {
  const source = Array.isArray(value) ? value : [];
  const seen = new Map<string, number>();
  return source.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

    const record = item as Record<string, unknown>;
    const question = normalizeText(record.question);
    const answer = normalizeText(record.answer);
    const enabled = record.enabled !== false;
    if (!question || !answer || (!includeDisabled && !enabled)) return [];

    const baseId = normalizeFaqId(record.id, `faq-${index + 1}`);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);

    return [
      {
        answer,
        enabled,
        id: count === 0 ? baseId : `${baseId}-${count + 1}`,
        question,
      },
    ];
  });
};

export const normalizePlanFaqSettings = (value: unknown): PlanFaqItem[] => {
  if (!Array.isArray(value)) return DEFAULT_PLAN_FAQ_ITEMS;

  return normalizePlanFaqRows(value, { includeDisabled: true });
};

export const normalizePlanFaqItems = (value: unknown): PlanFaqItem[] => {
  if (!Array.isArray(value)) return DEFAULT_PLAN_FAQ_ITEMS;

  return normalizePlanFaqRows(value, { includeDisabled: false });
};
