import { describe, expect, it } from 'vitest';

import {
  moduleAppBillingPayerSchema,
  moduleAppOrderSnapshotSchema,
  moduleAppProductSchema,
  moduleAppPurchaseInputSchema,
} from './moduleAppCommerce';

describe('module app commerce contracts', () => {
  it('accepts bounded yearly workspace subscriptions in minor currency units', () => {
    expect(
      moduleAppProductSchema.parse({
        billingPeriod: 'yearly',
        currency: 'CNY',
        licenseScope: 'workspace',
        price: 12_000,
        productType: 'subscription',
      }),
    ).toMatchObject({
      billingPeriod: 'yearly',
      licenseScope: 'workspace',
      price: 12_000,
      productType: 'subscription',
    });
  });

  it('rejects inconsistent product periods and unscoped team purchases', () => {
    expect(() =>
      moduleAppProductSchema.parse({
        billingPeriod: 'monthly',
        currency: 'CNY',
        licenseScope: 'personal',
        price: 100,
        productType: 'one_time',
      }),
    ).toThrow();

    expect(() =>
      moduleAppPurchaseInputSchema.parse({
        licenseScope: 'workspace',
        productId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow();
  });

  it('requires server-owned payer identities and immutable decimal snapshots', () => {
    expect(
      moduleAppBillingPayerSchema.parse({ scopeType: 'personal', userId: 'user-1' }),
    ).toEqual({ scopeType: 'personal', userId: 'user-1' });
    expect(() =>
      moduleAppBillingPayerSchema.parse({ scopeType: 'workspace', userId: 'user-1' }),
    ).toThrow();

    expect(
      moduleAppOrderSnapshotSchema.parse({
        billingPeriod: 'yearly',
        currency: 'CNY',
        licenseScope: 'workspace',
        moduleMultiplier: '1.3500',
        price: 12_000,
        productType: 'subscription',
        revenueShareRate: '0.8000',
      }),
    ).toMatchObject({ moduleMultiplier: '1.3500', revenueShareRate: '0.8000' });
  });
});
