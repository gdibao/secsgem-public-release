import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../type';
import { NotificationModel } from './notification';

vi.mock('@lobechat/database', () => { throw new Error('Forbidden database entry'); });
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => { throw new Error('Forbidden database'); } }));
vi.mock('../schemas/notification', async () => {
  const { pgTable, text, boolean, timestamp, jsonb } = await import('drizzle-orm/pg-core');
  return {
    notifications: pgTable('notifications', { id: text('id'), userId: text('user_id'), workspaceId: text('workspace_id'), type: text('type'), category: text('category'), metadata: jsonb('metadata'), dedupeKey: text('dedupe_key'), isArchived: boolean('is_archived'), isRead: boolean('is_read'), createdAt: timestamp('created_at'), updatedAt: timestamp('updated_at') }),
    notificationDeliveries: pgTable('notification_deliveries', { notificationId: text('notification_id') }),
  };
});
vi.mock('../schemas/task', async () => {
  const { pgTable, text, jsonb } = await import('drizzle-orm/pg-core');
  return {
    tasks: pgTable('tasks', { id: text('id'), workspaceId: text('workspace_id'), createdByUserId: text('created_by_user_id'), assigneeUserId: text('assignee_user_id'), projectId: text('project_id'), visibility: text('visibility') }),
    taskActivities: pgTable('task_activities', { id: text('id'), taskId: text('task_id'), workspaceId: text('workspace_id'), type: text('type'), payload: jsonb('payload') }),
  };
});
vi.mock('../schemas/project', async () => {
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  return { projects: pgTable('projects', { id: text('id'), workspaceId: text('workspace_id'), userId: text('user_id'), visibility: text('visibility') }) };
});
vi.mock('../schemas/workspace', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  return { workspaceMembers: pgTable('workspace_members', { userId: text('user_id'), workspaceId: text('workspace_id'), role: text('role'), deletedAt: timestamp('deleted_at') }) };
});

describe('NotificationModel assignment SQL ACL (compiled, not executed)', () => {
  let queries: { sql: string; params: unknown[] }[];
  let db: LobeChatDatabase;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Forbidden network'); }));
    queries = [];
    const chain = Promise.resolve([]) as unknown as Promise<unknown[]> & Record<string, unknown>;
    for (const name of ['from', 'orderBy', 'groupBy', 'limit', 'set']) chain[name] = vi.fn(() => chain);
    chain.where = vi.fn((sql) => { queries.push(new PgDialect().sqlToQuery(sql)); return chain; });
    db = { select: vi.fn(() => chain), update: vi.fn(() => chain) } as unknown as LobeChatDatabase;
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  const assertAcl = (query: { sql: string; params: unknown[] }, user: string) => {
    expect(query.sql).toContain('"notifications"."type" <>');
    expect(query.params).toContain('task_assignment');
    expect(query.sql).toContain(' or ');
    expect(query.sql).toContain('exists');
    for (const table of ['tasks', 'task_activities', 'workspace_members', 'projects']) expect(query.sql).toContain(`"${table}"`);
    expect(query.sql).toContain('"workspace_members"."deleted_at" is null');
    expect(query.sql).toContain('"tasks"."assignee_user_id"');
    expect(query.sql).toContain('"tasks"."created_by_user_id"');
    expect(query.sql).toContain('"projects"."user_id"');
    expect(query.sql).toContain('"tasks"."project_id" is null');
    expect(query.sql).toContain("'taskAssignment'");
    expect(query.sql).toContain("'eventId'");
    expect(query.sql).toContain("'taskId'");
    expect(query.sql).toContain("'toId'");
    expect(query.params).toContain(user);
  };
  it.each(['list', 'cursor', 'counts', 'unread', 'mark', 'markAll', 'archive', 'archiveAll'])('applies the same ACL before %s', async (op) => {
    const model = new NotificationModel(db, 'recipient-a', { workspaceId: 'ws-a' });
    if (op === 'list') await model.list();
    if (op === 'cursor') await model.list({ cursor: 'old-hidden-notification' });
    if (op === 'counts') await model.getNavigationCounts();
    if (op === 'unread') await model.getUnreadCount();
    if (op === 'mark') await model.markAsRead(['n1']);
    if (op === 'markAll') await model.markAllAsRead();
    if (op === 'archive') await model.archive('n1');
    if (op === 'archiveAll') await model.archiveAll();
    expect(queries.length).toBe(op === 'cursor' ? 2 : 1);
    for (const query of queries) { assertAcl(query, 'recipient-a'); expect(query.params).toContain('ws-a'); }
  });
  it('keeps non-task notifications in the OR branch without requiring metadata', async () => {
    await new NotificationModel(db, 'recipient').list({ category: 'billing' });
    expect(queries[0].sql).toMatch(/\("notifications"\."type" <> \$\d+ or /);
    expect(queries[0].params).toContain('billing');
    // No outer INNER JOIN may discard metadata-free legacy notifications.
    expect(queries[0].sql).not.toMatch(/^exists/);
  });
  it('preserves personal inbox scope rather than widening to workspaces', async () => {
    await new NotificationModel(db, 'personal-user', { workspaceId: null }).list();
    expect(queries[0].sql).toContain('"notifications"."workspace_id" is null');
    assertAcl(queries[0], 'personal-user');
  });
  it('binds a second workspace and recipient, without borrowing the first', async () => {
    await new NotificationModel(db, 'recipient-b', { workspaceId: 'ws-b' }).list();
    assertAcl(queries[0], 'recipient-b');
    expect(queries[0].params).toContain('ws-b');
    expect(queries[0].params).not.toContain('recipient-a');
    expect(queries[0].params).not.toContain('ws-a');
  });
});
