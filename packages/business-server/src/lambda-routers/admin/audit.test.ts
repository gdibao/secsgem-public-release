import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  recordAdminAudit,
  recordAdminAuditStrict,
  runRequiredAdminAuditExternalEffect,
  runRequiredAdminAuditMutation,
} from './audit';

const createDb = (
  insertResult: (value: Record<string, unknown>) => Promise<unknown>,
  findTerminal: () => Promise<unknown> = () => Promise.resolve(undefined),
) => {
  const values = vi.fn(insertResult);
  const findFirst = vi.fn(findTerminal);
  const db = {
    insert: vi.fn(() => ({ values })),
    query: { adminAuditLogs: { findFirst } },
  } as any;

  return { db, findFirst, values };
};

const context = (db: any) => ({
  clientIp: '203.0.113.9',
  serverDB: db,
  userId: 'admin-user',
});

const entry = {
  action: 'user.impersonate.attempt',
  resourceType: 'user',
  targetUserId: 'target-user',
};

describe('admin audit write modes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a required succeeded envelope with actor, target, client IP, and correlation ID', async () => {
    const { db, values } = createDb(() => Promise.resolve());

    await expect(
      recordAdminAudit(context(db), entry, {
        correlationId: 'audit-correlation-1',
        status: 'succeeded',
      }),
    ).resolves.toMatchObject({
      correlationId: 'audit-correlation-1',
      ok: true,
      status: 'succeeded',
    });

    expect(values).toHaveBeenCalledWith({
      action: 'user.impersonate.attempt',
      actorUserId: 'admin-user',
      ipAddress: '203.0.113.9',
      payload: {
        audit: {
          action: 'user.impersonate.attempt',
          actorUserId: 'admin-user',
          clientIp: '203.0.113.9',
          correlationId: 'audit-correlation-1',
          resourceId: null,
          resourceType: 'user',
          status: 'succeeded',
          targetUserId: 'target-user',
        },
        correlationId: 'audit-correlation-1',
        status: 'succeeded',
      },
      resourceId: null,
      resourceType: 'user',
      targetUserId: 'target-user',
    });
  });

  it('rejects required audit insert failures by default', async () => {
    const failure = new Error('audit insert failed');
    const { db } = createDb(() => Promise.reject(failure));

    await expect(recordAdminAudit(context(db), entry)).rejects.toBe(failure);
    await expect(recordAdminAuditStrict(context(db), entry)).rejects.toBe(failure);
  });

  it('keeps only explicitly best-effort audit non-blocking and returns a sanitized failure', async () => {
    const { db } = createDb(() => Promise.reject(new Error('password=hunter2')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordAdminAudit(
        context(db),
        {
          ...entry,
          action: 'newapiInstanceModels.refreshRuntimeCache',
          payload: { password: 'hunter2' },
        },
        {
          correlationId: 'audit-correlation-2',
          mode: 'best-effort',
          status: 'failed',
        },
      ),
    ).resolves.toEqual({
      correlationId: 'audit-correlation-2',
      ok: false,
      status: 'failed',
    });
    expect(consoleError).toHaveBeenCalledWith('[admin-audit] best-effort audit insert failed', {
      action: 'newapiInstanceModels.refreshRuntimeCache',
      correlationId: 'audit-correlation-2',
      status: 'failed',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('hunter2');
  });

  it('rejects a best-effort request for actions outside the low-risk allowlist', async () => {
    const { db } = createDb(() => Promise.reject(new Error('audit insert failed')));

    await expect(recordAdminAudit(context(db), entry, { mode: 'best-effort' })).rejects.toThrow(
      'ADMIN_AUDIT_BEST_EFFORT_NOT_ALLOWED',
    );
  });

  it('recursively redacts mixed-case sensitive fields in nested objects and arrays', async () => {
    const { db, values } = createDb(() => Promise.resolve());

    await recordAdminAudit(
      context(db),
      {
        ...entry,
        payload: {
          ApiKEY: 'key-value',
          array: [
            { Password: 'password-value', safe: 'visible' },
            { nested: { AUTHORIZATION: 'bearer-value', clientSecret: 'secret-value' } },
          ],
          certificatePem: 'certificate-value',
          cookieJar: { session: 'cookie-value' },
          safe: { count: 2, label: 'visible' },
          tokenValue: 'token-value',
        },
      },
      { correlationId: 'audit-correlation-3' },
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          ApiKEY: '[REDACTED]',
          array: [
            { Password: '[REDACTED]', safe: 'visible' },
            {
              nested: {
                AUTHORIZATION: '[REDACTED]',
                clientSecret: '[REDACTED]',
              },
            },
          ],
          certificatePem: '[REDACTED]',
          cookieJar: '[REDACTED]',
          correlationId: 'audit-correlation-3',
          safe: { count: 2, label: 'visible' },
          status: 'succeeded',
          tokenValue: '[REDACTED]',
        }),
      }),
    );
  });
});

describe('runRequiredAdminAuditMutation', () => {
  const createTransactionalDb = () => {
    const committed = { auditActions: [] as string[], businessWrites: [] as string[] };
    const transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const working = structuredClone(committed);
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn(async (value: Record<string, unknown>) => {
            if (value.action === 'audit.insert.failure') throw new Error('audit insert failed');
            working.auditActions.push(value.action as string);
          }),
        })),
        writeBusiness: (value: string) => working.businessWrites.push(value),
      };

      const result = await callback(tx);
      committed.auditActions = working.auditActions;
      committed.businessWrites = working.businessWrites;
      return result;
    });

    return { committed, db: { transaction } as any, transaction };
  };

  it('rolls back business writes when the required audit insert fails', async () => {
    const { committed, db } = createTransactionalDb();

    await expect(
      runRequiredAdminAuditMutation(context(db), {
        audit: () => ({ action: 'audit.insert.failure', resourceType: 'credit_account' }),
        mutation: async (tx: any) => {
          tx.writeBusiness('credit-adjustment');
          return { ok: true };
        },
      }),
    ).rejects.toThrow('audit insert failed');

    expect(committed).toEqual({ auditActions: [], businessWrites: [] });
  });

  it('does not commit an audit or partial business write when the business callback fails', async () => {
    const { committed, db } = createTransactionalDb();

    await expect(
      runRequiredAdminAuditMutation(context(db), {
        audit: () => ({ action: 'credits.adjust', resourceType: 'credit_account' }),
        mutation: async (tx: any) => {
          tx.writeBusiness('credit-adjustment');
          throw new Error('business write failed');
        },
      }),
    ).rejects.toThrow('business write failed');

    expect(committed).toEqual({ auditActions: [], businessWrites: [] });
  });

  it('commits the business write and correlated success audit together', async () => {
    const { committed, db, transaction } = createTransactionalDb();

    await expect(
      runRequiredAdminAuditMutation(context(db), {
        audit: (result) => ({
          action: 'credits.adjust',
          payload: result,
          resourceType: 'credit_account',
        }),
        correlationId: 'transaction-correlation',
        mutation: async (tx: any) => {
          tx.writeBusiness('credit-adjustment');
          return { amount: 100 };
        },
      }),
    ).resolves.toEqual({ amount: 100 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(committed).toEqual({
      auditActions: ['credits.adjust'],
      businessWrites: ['credit-adjustment'],
    });
  });
});

describe('runRequiredAdminAuditExternalEffect', () => {
  it('does not run an external effect when the required started audit fails', async () => {
    const failure = new Error('started audit insert failed');
    const { db } = createDb(() => Promise.reject(failure));
    const effect = vi.fn();

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        effect,
      }),
    ).rejects.toBe(failure);

    expect(effect).not.toHaveBeenCalled();
  });

  it('records correlated started and succeeded statuses around an external effect', async () => {
    const { db, values } = createDb(() => Promise.resolve());
    const effect = vi.fn().mockResolvedValue({ removed: true });

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        correlationId: 'external-effect-correlation',
        effect,
      }),
    ).resolves.toEqual({ removed: true });

    expect(effect).toHaveBeenCalledOnce();
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          correlationId: 'external-effect-correlation',
          status: 'started',
        }),
      }),
    );
    expect(values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({
          correlationId: 'external-effect-correlation',
          status: 'succeeded',
        }),
      }),
    );
  });

  it('retries a terminal audit write after the external effect succeeds', async () => {
    let terminalAttempts = 0;
    const { db, values } = createDb(async (value) => {
      const status = (value.payload as Record<string, unknown>).status;
      if (status === 'succeeded' && ++terminalAttempts === 1) {
        throw new Error('temporary terminal audit failure');
      }
    });

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        correlationId: 'retry-terminal-correlation',
        effect: async () => ({ removed: true }),
      }),
    ).resolves.toEqual({ removed: true });

    expect(values).toHaveBeenCalledTimes(3);
    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'succeeded',
      'succeeded',
    ]);
  });

  it('does not duplicate a terminal row after an ambiguous insert acknowledgement', async () => {
    let terminalPersisted = false;
    let terminalAuditId: string | undefined;
    const { db, findFirst, values } = createDb(
      async (value) => {
        if ((value.payload as Record<string, unknown>).status === 'succeeded') {
          terminalAuditId = (value.payload as Record<string, unknown>).terminalAuditId as string;
          terminalPersisted = true;
          throw new Error('connection closed after commit');
        }
      },
      async () =>
        terminalPersisted
          ? { payload: { terminalAuditId } }
          : undefined,
    );

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        correlationId: 'ambiguous-terminal-correlation',
        effect: async () => ({ removed: true }),
      }),
    ).resolves.toEqual({ removed: true });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'succeeded',
    ]);
    expect(terminalAuditId).toEqual(expect.any(String));
  });

  it('does not mistake another audit phase for the external terminal row', async () => {
    let terminalAttempts = 0;
    const { db, values } = createDb(
      async (value) => {
        if (
          (value.payload as Record<string, unknown>).status === 'succeeded' &&
          ++terminalAttempts === 1
        ) {
          throw new Error('temporary terminal audit failure');
        }
      },
      async () => ({
        payload: {
          correlationId: 'shared-maintenance-correlation',
          phase: 'database',
          status: 'succeeded',
        },
      }),
    );

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'setting.maintenance.run', resourceType: 'maintenance' }),
        correlationId: 'shared-maintenance-correlation',
        effect: async () => ({ failed: 0, processed: 3 }),
      }),
    ).resolves.toEqual({ failed: 0, processed: 3 });

    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'succeeded',
      'succeeded',
    ]);
  });

  it('records a classified failed terminal status without changing the effect result contract', async () => {
    const { db, values } = createDb(() => Promise.resolve());

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'setting.maintenance.run', resourceType: 'maintenance' }),
        effect: async () => ({ failed: 1, processed: 3 }),
        terminalStatus: (result) => (result.failed > 0 ? 'failed' : 'succeeded'),
      }),
    ).resolves.toEqual({ failed: 1, processed: 3 });

    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'failed',
    ]);
  });

  it('records recovery-required failure when terminal classification throws after the effect', async () => {
    const classifierFailure = new Error('terminal classifier failed');
    const { db, values } = createDb(() => Promise.resolve());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'setting.maintenance.run', resourceType: 'maintenance' }),
        correlationId: 'classifier-failure-correlation',
        effect: async () => ({ failed: 0, processed: 3 }),
        terminalStatus: () => {
          throw classifierFailure;
        },
      }),
    ).rejects.toMatchObject({
      details: { cause: classifierFailure, status: 'failed' },
      recoveryRequired: true,
    });

    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'failed',
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      '[admin-audit] external effect terminal audit recovery required',
      expect.objectContaining({
        action: 'setting.maintenance.run',
        correlationId: 'classifier-failure-correlation',
        recoveryRequired: true,
        status: 'failed',
      }),
    );
  });

  it('marks recovery as required when every terminal audit attempt fails after the effect succeeds', async () => {
    const { db, values } = createDb(async (value) => {
      if ((value.payload as Record<string, unknown>).status !== 'started') {
        throw new Error('terminal audit insert failed');
      }
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        correlationId: 'recovery-required-correlation',
        effect: async () => ({ removed: true }),
      }),
    ).rejects.toMatchObject({ recoveryRequired: true });

    expect(values.mock.calls.map(([value]) => (value.payload as any).status)).toEqual([
      'started',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      '[admin-audit] external effect terminal audit recovery required',
      expect.objectContaining({
        action: 'content.file.delete',
        correlationId: 'recovery-required-correlation',
        recoveryRequired: true,
        status: 'succeeded',
      }),
    );
  });

  it('preserves the effect failure when its terminal audit cannot be persisted', async () => {
    const effectFailure = new Error('storage cleanup failed');
    const { db } = createDb(async (value) => {
      if ((value.payload as Record<string, unknown>).status !== 'started') {
        throw new Error('terminal audit insert failed');
      }
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      runRequiredAdminAuditExternalEffect(context(db), {
        audit: () => ({ action: 'content.file.delete', resourceType: 'file' }),
        correlationId: 'failed-effect-recovery-correlation',
        effect: async () => {
          throw effectFailure;
        },
      }),
    ).rejects.toBe(effectFailure);

    expect(consoleError).toHaveBeenCalledWith(
      '[admin-audit] external effect terminal audit recovery required',
      expect.objectContaining({
        correlationId: 'failed-effect-recovery-correlation',
        recoveryRequired: true,
        status: 'failed',
      }),
    );
  });
});
