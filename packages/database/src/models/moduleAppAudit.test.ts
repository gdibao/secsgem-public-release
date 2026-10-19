import { describe, expect, it, vi } from 'vitest';

import { ModuleAppAuditModel } from './moduleAppAudit';

describe('ModuleAppAuditModel.writeAuditLog', () => {
  it('normalizes module-specific rows to the common redacted envelope', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as any;
    const model = new ModuleAppAuditModel(db);

    await model.writeAuditLog({
      actorUserId: 'module-user',
      clientIp: '203.0.113.7',
      correlationId: 'runtime-correlation',
      eventType: 'module_app.run_succeeded',
      metadata: { credentials: [{ token: 'secret-value' }], runId: 'run-1' },
      resourceId: 'app-1',
      resourceType: 'moduleApp',
      status: 'succeeded',
      targetUserId: 'runtime-user',
    });

    expect(values).toHaveBeenCalledWith({
      actorUserId: 'module-user',
      eventType: 'module_app.run_succeeded',
      metadata: {
        action: 'module_app.run_succeeded',
        audit: {
          action: 'module_app.run_succeeded',
          actorUserId: 'module-user',
          clientIp: '203.0.113.7',
          correlationId: 'runtime-correlation',
          resourceId: 'app-1',
          resourceType: 'moduleApp',
          status: 'succeeded',
          targetUserId: 'runtime-user',
        },
        correlationId: 'runtime-correlation',
        credentials: [{ token: '[REDACTED]' }],
        resourceId: 'app-1',
        resourceType: 'moduleApp',
        runId: 'run-1',
        status: 'succeeded',
      },
      resourceId: 'app-1',
      resourceType: 'moduleApp',
    });
  });
});
