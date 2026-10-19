import { describe, expect, it, vi } from 'vitest';

import { writeModuleAppAuditLog } from './audit';

describe('writeModuleAppAuditLog', () => {
  it('stores the shared redacted audit envelope for a module-specific event', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as any;

    await writeModuleAppAuditLog({
      actorUserId: 'admin-user',
      clientIp: '203.0.113.8',
      correlationId: 'module-audit-correlation',
      db,
      eventType: 'module_app.payout_paid',
      metadata: { nested: { APIKey: 'secret-value' }, totalAmount: 42 },
      resourceId: 'payout-1',
      resourceType: 'moduleAppPayout',
      status: 'succeeded',
      targetUserId: 'publisher-user',
    });

    expect(values).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      eventType: 'module_app.payout_paid',
      metadata: {
        action: 'module_app.payout_paid',
        audit: {
          action: 'module_app.payout_paid',
          actorUserId: 'admin-user',
          clientIp: '203.0.113.8',
          correlationId: 'module-audit-correlation',
          resourceId: 'payout-1',
          resourceType: 'moduleAppPayout',
          status: 'succeeded',
          targetUserId: 'publisher-user',
        },
        correlationId: 'module-audit-correlation',
        nested: { APIKey: '[REDACTED]' },
        resourceId: 'payout-1',
        resourceType: 'moduleAppPayout',
        status: 'succeeded',
        totalAmount: 42,
      },
      resourceId: 'payout-1',
      resourceType: 'moduleAppPayout',
    });
  });
});
