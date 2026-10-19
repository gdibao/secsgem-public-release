import { describe, expect, it } from 'vitest';

import {
  clearModuleDraft,
  createModuleDraftScope,
  loadModuleDraft,
  saveModuleDraft,
} from './draftStorage';

const createStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe('module app draft storage', () => {
  it('isolates drafts by app id and view', () => {
    const storage = createStorage();
    const newConfiguration = createModuleDraftScope('new', 'configuration');
    const appEntitlements = createModuleDraftScope('app-1', 'entitlements');

    saveModuleDraft(newConfiguration, { displayName: 'Draft app' }, storage);
    saveModuleDraft(appEntitlements, { plan: 'team' }, storage);

    expect(loadModuleDraft(newConfiguration, storage)).toEqual({ displayName: 'Draft app' });
    expect(loadModuleDraft(appEntitlements, storage)).toEqual({ plan: 'team' });

    clearModuleDraft(newConfiguration, storage);
    expect(loadModuleDraft(newConfiguration, storage)).toBeNull();
    expect(loadModuleDraft(appEntitlements, storage)).toEqual({ plan: 'team' });
  });

  it('clears corrupt and version-mismatched envelopes', () => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'configuration');
    const key = `admin-module-app-draft:v1:${scope}`;

    storage.setItem(key, '{not-json');
    expect(loadModuleDraft(scope, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();

    storage.setItem(key, JSON.stringify({ data: { displayName: 'Old' }, version: 2 }));
    expect(loadModuleDraft(scope, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('clears stored envelopes containing sensitive finance fields', () => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'configuration');
    const key = `admin-module-app-draft:v1:${scope}`;

    storage.setItem(key, JSON.stringify({ data: { bankAccount: 'sensitive' }, version: 1 }));

    expect(loadModuleDraft(scope, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('refuses finance, payout recipient, and evidence fields', () => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'configuration');

    expect(() =>
      saveModuleDraft(scope, { nested: { alipayAccount: 'sensitive' } }, storage),
    ).toThrow(/sensitive/i);
    expect(() => saveModuleDraft(scope, { payoutRecipient: 'sensitive' }, storage)).toThrow(
      /sensitive/i,
    );
    expect(() => saveModuleDraft(scope, { evidence: ['sensitive'] }, storage)).toThrow(
      /sensitive/i,
    );
    expect(() => saveModuleDraft(scope, { bankAccount: 'sensitive' }, storage)).toThrow(
      /sensitive/i,
    );
    expect(storage.values.size).toBe(0);
  });

  it.each([
    'batchId',
    'discrepancyId',
    'discrepancyIds',
    'licenseId',
    'licenseIds',
    'offlineRefundReference',
    'orderId',
    'outTradeNo',
    'paymentReference',
    'payoutBatchIds',
    'providerRefundId',
    'providerTransactionId',
    'refundIds',
    'refundReference',
    'requestedAmount',
    'revenueEntryId',
    'revenueEntryIds',
    'settlementBatchId',
    'transactionNo',
  ])('refuses sensitive finance field %s on save and load', (field) => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'entitlements');
    const key = `admin-module-app-draft:v1:${scope}`;

    expect(() => saveModuleDraft(scope, { [field]: 'sensitive' }, storage)).toThrow(/sensitive/i);
    expect(storage.values.size).toBe(0);

    storage.setItem(key, JSON.stringify({ data: { [field]: 'sensitive' }, version: 1 }));
    expect(loadModuleDraft(scope, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it.each([
    { metadata: { name: 'paymentRecipientId', value: 'recipient-1' } },
    { headers: [{ name: 'Authorization', value: 'Bearer secret' }] },
    { env: [{ key: 'OPENAI_API_KEY', value: 'secret' }] },
    { variables: [{ variableName: 'payoutTransactionNo', value: 'trade-1' }] },
    { headers: [['Authorization', 'Bearer secret']] },
    { env: [['OPENAI_API_KEY', 'secret']] },
    { metadata: [['paymentRecipientId', 'recipient-1']] },
    { variables: [['payoutTransactionNo', 'trade-1']] },
    { botToken: 'secret' },
    { env: [['GITHUB_TOKEN', 'secret']] },
    { jwtToken: 'secret' },
    { metadata: { name: 'paymentMethodId', value: 'pm_123' } },
  ])('refuses sensitive fields hidden behind generic descriptors', (draft) => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'configuration');
    const key = `admin-module-app-draft:v1:${scope}`;

    expect(() => saveModuleDraft(scope, draft, storage)).toThrow(/sensitive/i);
    expect(storage.values.size).toBe(0);

    storage.setItem(key, JSON.stringify({ data: draft, version: 1 }));
    expect(loadModuleDraft(scope, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('allows non-sensitive generic configuration descriptors', () => {
    const storage = createStorage();
    const scope = createModuleDraftScope('app-1', 'configuration');
    const draft = {
      actions: [{ name: 'Token counter' }],
      headers: [{ name: 'Accept-Language', value: 'zh-CN' }],
      inputSchema: { fields: [{ name: 'maxTokens', type: 'number' }] },
      metadata: {
        columns: ['paymentId', 'status', 'createdAt'],
        name: 'payment-history',
        pairLabels: ['paymentId', 'status'],
        value: 'compact',
      },
      pages: [{ key: 'payment-history', title: 'Payment history' }],
      requestSchema: { headers: { labels: ['Authorization', 'Content-Type'] } },
      usage: { tokenBudget: 8000, tokenCount: 1200 },
    };

    saveModuleDraft(scope, draft, storage);

    expect(loadModuleDraft(scope, storage)).toEqual(draft);
  });

  it('refuses draft scopes outside configuration and entitlements', () => {
    const storage = createStorage();

    expect(() => saveModuleDraft('app-1/payments', { note: 'do not persist' }, storage)).toThrow(
      /scope/i,
    );
    expect(storage.values.size).toBe(0);
  });
});
