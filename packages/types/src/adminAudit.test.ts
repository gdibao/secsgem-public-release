import { describe, expect, it } from 'vitest';

import { createAuditEnvelope, readAuditEnvelope } from './adminAudit';

describe('admin audit envelope contract', () => {
  it('preserves safe metadata and exposes one redacted audit shape to every audit store', () => {
    const value = createAuditEnvelope({
      audit: {
        action: 'module_app.payout_paid',
        actorUserId: 'admin-user',
        clientIp: '203.0.113.6',
        correlationId: 'shared-correlation',
        resourceId: 'payout-1',
        resourceType: 'moduleAppPayout',
        status: 'succeeded',
        targetUserId: 'publisher-user',
      },
      payload: {
        filters: { status: 'paid' },
        nested: { apiKey: 'secret-value' },
      },
    });

    expect(value).toEqual({
      audit: {
        action: 'module_app.payout_paid',
        actorUserId: 'admin-user',
        clientIp: '203.0.113.6',
        correlationId: 'shared-correlation',
        resourceId: 'payout-1',
        resourceType: 'moduleAppPayout',
        status: 'succeeded',
        targetUserId: 'publisher-user',
      },
      filters: { status: 'paid' },
      nested: { apiKey: '[REDACTED]' },
    });
    expect(readAuditEnvelope(value)).toEqual(value.audit);
  });

  it('rejects malformed and legacy audit payloads at runtime', () => {
    expect(readAuditEnvelope({ correlationId: 'legacy', status: 'succeeded' })).toBeUndefined();
    expect(
      readAuditEnvelope({
        audit: {
          action: 'credits.export',
          actorUserId: 'admin-user',
          clientIp: null,
          correlationId: 'invalid-status',
          resourceId: null,
          resourceType: 'credit_account',
          status: 'complete',
          targetUserId: null,
        },
      }),
    ).toBeUndefined();
    expect(
      readAuditEnvelope({
        audit: {
          action: 'credits.export',
          actorUserId: 42,
          clientIp: null,
          correlationId: 'invalid-actor',
          resourceId: null,
          resourceType: 'credit_account',
          status: 'succeeded',
          targetUserId: null,
        },
      }),
    ).toBeUndefined();
  });
});
