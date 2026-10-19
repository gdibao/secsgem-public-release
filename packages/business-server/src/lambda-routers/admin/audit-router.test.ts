import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { recordAdminAudit } from './audit';
import { adminAuditRouter } from './audit-router';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
}));

const createDb = () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const countWhere = vi.fn().mockResolvedValue([{ value: 0 }]);
  const from = vi.fn(() => ({ where: countWhere }));
  const select = vi.fn(() => ({ from }));

  const db = {
    query: {
      adminAuditLogs: {
        findMany,
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
      },
    },
    select,
  };

  return { countWhere, db, findMany };
};

const buildSql = (condition: unknown) => new PgDialect().sqlToQuery(condition as any);

describe('adminAuditRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('filters audit list rows by actor, target, resource, action, and created range', async () => {
    const { countWhere, db, findMany } = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-02T00:00:00.000Z';

    const result = await adminAuditRouter.createCaller({ userId: 'admin-user' } as any).list({
      action: 'credits.adjust',
      actorUserId: 'admin-user',
      cursor: 0,
      from,
      limit: 50,
      resourceId: 'ledger-1',
      resourceType: 'creditLedger',
      targetUserId: 'target-user',
      to,
    } as any);

    expect(result).toEqual({ items: [], nextCursor: null, total: 0 });

    const findWhere = findMany.mock.calls[0]?.[0].where;
    const countWhereArg = countWhere.mock.calls[0]?.[0];
    const built = buildSql(findWhere);

    expect(buildSql(countWhereArg)).toEqual(built);
    expect(built.sql).toBe(
      '("admin_audit_logs"."action" = $1 and "admin_audit_logs"."actor_user_id" = $2 and "admin_audit_logs"."target_user_id" = $3 and "admin_audit_logs"."resource_type" = $4 and "admin_audit_logs"."resource_id" = $5 and "admin_audit_logs"."created_at" >= $6 and "admin_audit_logs"."created_at" <= $7)',
    );
    expect(built.params).toStrictEqual([
      'credits.adjust',
      'admin-user',
      'target-user',
      'creditLedger',
      'ledger-1',
      from,
      to,
    ]);
  });

  it('applies resource and created range filters to audit exports', async () => {
    const { db, findMany } = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const from = '2026-05-01T00:00:00.000Z';
    const to = '2026-05-31T23:59:59.999Z';

    await adminAuditRouter.createCaller({ userId: 'admin-user' } as any).exportAll({
      from,
      limit: 1000,
      resourceId: 'order-1',
      resourceType: 'order',
      to,
    } as any);

    const built = buildSql(findMany.mock.calls[0]?.[0].where);

    expect(built.sql).toBe(
      '("admin_audit_logs"."resource_type" = $1 and "admin_audit_logs"."resource_id" = $2 and "admin_audit_logs"."created_at" >= $3 and "admin_audit_logs"."created_at" <= $4)',
    );
    expect(built.params).toStrictEqual(['order', 'order-1', from, to]);
  });

  it('records bounded safe export filters without identifiers, rows, or personal query values', async () => {
    const { db, findMany } = createDb();
    findMany.mockResolvedValue([{ id: 'audit-1' }, { id: 'audit-2' }]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    await adminAuditRouter.createCaller({ userId: 'admin-user' } as any).exportAll({
      action: 'order.cancel',
      actorUserId: 'person@example.com',
      from: new Date('2026-05-01T00:00:00.000Z'),
      limit: 1000,
      resourceId: 'order-1',
      resourceType: 'order',
      to: new Date('2026-05-31T23:59:59.999Z'),
    });

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-user' }),
      {
        action: 'admin.audit.export',
        payload: {
          count: 2,
          filters: {
            action: 'order.cancel',
            from: '2026-05-01T00:00:00.000Z',
            hasActorUserId: true,
            hasResourceId: true,
            resourceType: 'order',
            to: '2026-05-31T23:59:59.999Z',
          },
          limit: 1000,
        },
        resourceType: 'admin_audit_log',
      },
    );
    expect(JSON.stringify(vi.mocked(recordAdminAudit).mock.calls)).not.toContain(
      'person@example.com',
    );
  });
});
