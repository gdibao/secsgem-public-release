import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { notifyTaskAssigned } from './notifyTaskAssigned';

const m = vi.hoisted(() => ({
  delivery: vi.fn(), forbidden: vi.fn(), member: vi.fn(), notification: vi.fn(),
  project: vi.fn(), task: vi.fn(),
}));
vi.mock('@lobechat/database', () => ({ get serverDB() { return m.forbidden(); } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: m.forbidden }));
vi.mock('@/database/schemas/task', async () => {
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  return { taskActivities: pgTable('task_activities', { id: text('id'), taskId: text('task_id'), workspaceId: text('workspace_id') }) };
});
vi.mock('@/database/models/task', () => ({ TaskModel: class {
  constructor(private db: unknown, private user: string, private ws?: string) {}
  findById(id: string) { return m.task(this.db, this.user, this.ws, id); }
} }));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {
  constructor(private db: unknown, private user: string, private ws?: string) {}
  findById(id: string) { return m.project(this.db, this.user, this.ws, id); }
} }));
vi.mock('@/database/models/workspaceMember', () => ({ WorkspaceMemberModel: class {
  constructor(private db: unknown, private user: string) {}
  getMember(ws: string, user: string) { return m.member(this.db, this.user, ws, user); }
} }));
vi.mock('@/database/models/notification', () => ({ NotificationModel: class {
  constructor(private db: unknown, private user: string) {}
  create(data: unknown) { return m.notification(this.db, this.user, data); }
  createDelivery(data: unknown) { return m.delivery(this.db, data); }
} }));

describe('task assignment inbox persistence (mock DB)', () => {
  const params = { actorUserId: 'actor', assigneeUserId: 'recipient', eventId: 'event-1', taskId: 'task-1', workspaceId: 'ws-a' };
  let event: Record<string, unknown>;
  let task: Record<string, unknown>;
  let rows: Map<string, unknown>;
  let deliveries: unknown[];
  let tx: LobeChatDatabase;
  let db: LobeChatDatabase;
  let where: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetAllMocks();
    m.forbidden.mockImplementation(() => { throw new Error('Forbidden real side effect'); });
    vi.stubGlobal('fetch', m.forbidden);
    event = { id: 'event-1', taskId: 'task-1', workspaceId: 'ws-a', userId: 'actor', type: 'assignee_user', payload: { fromId: null, toId: 'recipient' } };
    task = { id: 'task-1', workspaceId: 'ws-a', assigneeUserId: 'recipient', projectId: 'project-1', name: 'Authorized current title', identifier: 'TASK-1' };
    rows = new Map(); deliveries = [];
    where = vi.fn(() => ({ limit: vi.fn(async () => [event]) }));
    tx = { select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) } as unknown as LobeChatDatabase;
    transaction = vi.fn(async (callback: (runner: LobeChatDatabase) => Promise<unknown>) => {
      const saved = new Map(rows); const savedDeliveries = [...deliveries];
      try { return await callback(tx); }
      catch (error) { rows = saved; deliveries = savedDeliveries; throw error; }
    });
    db = { transaction } as unknown as LobeChatDatabase;
    m.member.mockResolvedValue({ role: 'member', deletedAt: null });
    m.task.mockImplementation(async () => task);
    m.project.mockResolvedValue({ id: 'project-1' });
    m.notification.mockImplementation(async (_db, user, data) => {
      const key = `${user}:${data.dedupeKey}`;
      if (rows.has(key)) return null;
      const row = { ...data, id: `notification-${rows.size}`, userId: user };
      rows.set(key, row); return row;
    });
    m.delivery.mockImplementation(async (_db, data) => { deliveries.push(data); return data; });
  });
  afterEach(() => { expect(m.forbidden).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it('keeps the legacy post-response hook side-effect free without a persistent event', async () => {
    const legacy = { actorUserId: 'actor', assigneeUserId: 'recipient', taskId: 'task-1', taskIdentifier: 'TASK-1', taskName: 'Legacy title', workspaceId: 'ws-a' };
    await expect(notifyTaskAssigned(legacy)).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
    expect(m.notification).not.toHaveBeenCalled();
    expect(m.delivery).not.toHaveBeenCalled();
  });
  it('does not duplicate the transactional receipt when the legacy hook runs afterwards', async () => {
    await notifyTaskAssigned(db, params);
    await expect(notifyTaskAssigned({ actorUserId: 'actor', assigneeUserId: 'recipient', taskId: 'task-1', taskIdentifier: 'TASK-1', workspaceId: 'ws-a' })).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1); expect(deliveries).toHaveLength(1);
  });

  it('authorizes current task/project and creates one atomic inbox delivery', async () => {
    await notifyTaskAssigned(db, params);
    expect(m.member).toHaveBeenCalledWith(tx, 'recipient', 'ws-a', 'recipient');
    expect(m.task).toHaveBeenCalledWith(tx, 'recipient', 'ws-a', 'task-1');
    expect(m.project).toHaveBeenCalledWith(tx, 'recipient', 'ws-a', 'project-1');
    expect(m.notification).toHaveBeenCalledWith(tx, 'recipient', expect.objectContaining({
      type: 'task_assignment', workspaceId: 'ws-a',
      metadata: { taskAssignment: { eventId: 'event-1', taskId: 'task-1' } },
      content: 'Authorized current title',
    }));
    expect(m.delivery).toHaveBeenCalledWith(tx, expect.objectContaining({ channel: 'inbox', status: 'delivered', notificationId: 'notification-0' }));
    expect(rows.size).toBe(1); expect(deliveries).toHaveLength(1);
  });
  it('deduplicates a retry of the same persistent event without another delivery', async () => {
    await notifyTaskAssigned(db, params); await notifyTaskAssigned(db, params);
    expect(rows.size).toBe(1); expect(deliveries).toHaveLength(1);
  });
  it('allows a later valid assignment of the same task to the same person', async () => {
    await notifyTaskAssigned(db, params);
    event.id = 'event-2';
    await notifyTaskAssigned(db, { ...params, eventId: 'event-2' });
    expect(rows.size).toBe(2); expect(deliveries).toHaveLength(2);
  });
  it('scopes a second workspace independently', async () => {
    event.workspaceId = 'ws-b'; task.workspaceId = 'ws-b';
    await notifyTaskAssigned(db, { ...params, workspaceId: 'ws-b' });
    expect(m.task).toHaveBeenCalledWith(tx, 'recipient', 'ws-b', 'task-1');
    expect([...rows.keys()][0]).toContain('ws-b');
  });
  it.each(['missing', 'id', 'task', 'workspace', 'recipient', 'actor', 'type', 'unchanged'])('rejects invalid event: %s', async (kind) => {
    if (kind === 'missing') where.mockReturnValue({ limit: vi.fn(async () => []) });
    if (kind === 'id') event.id = 'forged';
    if (kind === 'task') event.taskId = 'foreign-task';
    if (kind === 'workspace') event.workspaceId = 'foreign-ws';
    if (kind === 'recipient') event.payload = { toId: 'someone-else' };
    if (kind === 'actor') event.userId = 'someone-else';
    if (kind === 'type') event.type = 'status';
    if (kind === 'unchanged') event.payload = { fromId: 'recipient', toId: 'recipient' };
    await notifyTaskAssigned(db, params);
    expect(rows.size).toBe(0); expect(m.notification).not.toHaveBeenCalled();
  });
  it.each(['removed', 'invalid-role', 'task-hidden', 'project-hidden', 'task-moved', 'reassigned'])('does not disclose on %s', async (kind) => {
    if (kind === 'removed') m.member.mockResolvedValue(null);
    if (kind === 'invalid-role') m.member.mockResolvedValue({ role: 'constructor' });
    if (kind === 'task-hidden') m.task.mockResolvedValue(null);
    if (kind === 'project-hidden') m.project.mockResolvedValue(null);
    if (kind === 'task-moved') task.workspaceId = 'ws-b';
    if (kind === 'reassigned') task.assigneeUserId = 'other';
    await notifyTaskAssigned(db, params);
    expect(m.notification).not.toHaveBeenCalled(); expect(m.delivery).not.toHaveBeenCalled();
  });
  it('allows a task without a project', async () => {
    task.projectId = null;
    await notifyTaskAssigned(db, params);
    expect(m.project).not.toHaveBeenCalled(); expect(rows.size).toBe(1);
  });
  it.each(['self', 'personal'])('keeps %s assignments silent', async (kind) => {
    await notifyTaskAssigned(db, { ...params, ...(kind === 'self' ? { assigneeUserId: 'actor' } : { workspaceId: undefined }) });
    expect(transaction).not.toHaveBeenCalled(); expect(rows.size).toBe(0);
  });
  it('rolls back the receipt when inbox delivery fails; retry can succeed', async () => {
    const error = new Error('synthetic delivery failure');
    m.delivery.mockRejectedValueOnce(error);
    await expect(notifyTaskAssigned(db, params)).rejects.toBe(error);
    expect(rows.size).toBe(0); expect(deliveries).toHaveLength(0);
    await notifyTaskAssigned(db, params);
    expect(rows.size).toBe(1); expect(deliveries).toHaveLength(1);
  });
  it('propagates a business/database error instead of treating it as dedupe', async () => {
    const error = new Error('not a dedupe conflict');
    m.notification.mockRejectedValue(error);
    await expect(notifyTaskAssigned(db, params)).rejects.toBe(error);
    expect(m.delivery).not.toHaveBeenCalled();
  });
});
