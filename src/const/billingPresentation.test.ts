import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN_FAQ_ITEMS,
  normalizePlanFaqItems,
  normalizePlanFaqSettings,
  normalizePlanCatalogPresentation,
  normalizeTopUpPackagePromotion,
  serializeTopUpPackagePromotion,
} from './billingPresentation';

describe('billingPresentation', () => {
  it('normalizes plan catalog metadata for user-facing pricing displays', () => {
    expect(
      normalizePlanCatalogPresentation({
        badge: ' Popular ',
        comparisonNote: ' Includes priority access ',
        pptCreditCost: 15,
        pptEnabled: true,
        pptMonthlyQuota: 20,
        storageQuotaMb: 1024,
        vectorQuota: 5000,
        yearlyDiscountLabel: ' Save 20% ',
      }),
    ).toEqual({
      badge: 'Popular',
      comparisonNote: 'Includes priority access',
      pptCreditCost: 15,
      pptEnabled: true,
      pptMonthlyQuota: 20,
      storageQuotaMb: 1024,
      vectorQuota: 5000,
      yearlyDiscountLabel: 'Save 20%',
    });
  });

  it('keeps nullable quotas and rejects invalid numeric plan metadata', () => {
    expect(
      normalizePlanCatalogPresentation({
        pptCreditCost: -1,
        pptMonthlyQuota: '',
        storageQuotaMb: null,
        vectorQuota: 'bad',
      }),
    ).toEqual({
      badge: '',
      comparisonNote: '',
      pptCreditCost: 0,
      pptEnabled: false,
      pptMonthlyQuota: null,
      storageQuotaMb: null,
      vectorQuota: null,
      yearlyDiscountLabel: '',
    });
  });

  it('normalizes top-up promotion metadata', () => {
    expect(
      normalizeTopUpPackagePromotion({
        originalAmount: 30,
        promotionEnabled: true,
        promotionLabel: ' Limited offer ',
        promotionNote: ' Valid for 6 months ',
      }),
    ).toEqual({
      enabled: true,
      label: 'Limited offer',
      note: 'Valid for 6 months',
      originalAmount: 30,
    });
  });

  it('rejects invalid top-up promotion original amounts', () => {
    expect(
      normalizeTopUpPackagePromotion({
        originalAmount: -30,
        promotionEnabled: true,
        promotionLabel: ' Sale ',
        promotionNote: ' Use soon ',
      }),
    ).toStrictEqual({
      enabled: true,
      label: 'Sale',
      note: 'Use soon',
    });
  });

  it('omits undefined original amounts when serializing top-up promotion metadata', () => {
    expect(
      serializeTopUpPackagePromotion({
        enabled: false,
        label: '',
        note: '',
      }),
    ).toStrictEqual({
      promotionEnabled: false,
      promotionLabel: '',
      promotionNote: '',
    });
  });

  it('normalizes configurable plan FAQ items', () => {
    expect(
      normalizePlanFaqItems([
        { answer: ' Usage units. ', enabled: true, id: 'credits', question: ' What are credits? ' },
        { answer: ' Still visible ', enabled: true, id: 'credits', question: ' Duplicate ' },
        { answer: 'hidden', enabled: true, id: 'blank', question: '' },
        { answer: 'Hidden', enabled: false, id: 'disabled', question: 'Disabled' },
      ]),
    ).toEqual([
      { answer: 'Usage units.', enabled: true, id: 'credits', question: 'What are credits?' },
      { answer: 'Still visible', enabled: true, id: 'credits-2', question: 'Duplicate' },
    ]);

    expect(normalizePlanFaqItems(null)).toEqual(DEFAULT_PLAN_FAQ_ITEMS);
  });

  it('preserves disabled and empty FAQ rows for admin settings', () => {
    expect(
      normalizePlanFaqSettings([
        { answer: 'Hidden answer', enabled: false, id: 'hidden', question: 'Hidden?' },
        { answer: '', enabled: true, id: 'blank', question: 'Blank?' },
      ]),
    ).toEqual([
      { answer: 'Hidden answer', enabled: false, id: 'hidden', question: 'Hidden?' },
    ]);

    expect(normalizePlanFaqSettings([])).toEqual([]);
    expect(normalizePlanFaqSettings(null)).toEqual(DEFAULT_PLAN_FAQ_ITEMS);
  });
});
