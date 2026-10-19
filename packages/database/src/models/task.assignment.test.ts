import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskActivityItem } from '../schemas/task';
import type { LobeChatDatabase } from '../type';
import { TaskModel } from './task';

vi.mock('@lobechat/database', () => { throw new Error('Forbidden database entry'); });
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => { throw new Error('Forbidden database'); } }));
vi.mock('@/utils/merge', () => ({ merge: Object.assign }));
vi.mock('../schemas/task', async () => {
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  const table = pgTable('tasks', {
    id: text('id'), createdByUserId: text('created_by_user_id'), workspaceId: text('workspace_id'), visibility: text('visibility'),
    assigneeAgentId: text('assignee_agent_id'), assigneeUserId: text('assignee_user_id'),
    automationMode: text('automation_mode'), config: text('config'), heartbeatInterval: text('heartbeat_interval'),
    priority: text('priority'), schedulePattern: text('schedule_pattern'), scheduleTimezone: text('schedule_timezone'), status: text('status'),
  });
  return { tasks: table, taskActivities: table, taskComments: table, taskDependencies: table, taskDocuments: table, taskTopics: table };
});
vi.mock('../schemas/file', () => ({ documents: {} }));
vi.mock('../schemas/topic', () => ({ topics: {} }));
vi.mock('../schemas/verify', () => ({ acceptances: {} }));
vi.mock('../schemas/work', () => ({ works: {} }));

describe('TaskModel persisted assignment callback (mock transaction)', () => {
  let before: Record<string, unknown>;
  let updated: Record<string, unknown>;
  let db: LobeChatDatabase;
  let tx: LobeChatDatabase;
  let events: TaskActivityItem[];
  let callback: ReturnType<typeof vi.fn<NonNullable<Parameters<TaskModel['updateWithLog']>[3]>>>;
  let transaction: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    events = [];
    before = { assigneeUserId: 'old-recipient', assigneeAgentId: null, automationMode: null, priority: null, status: 'backlog' };
    updated = { ...before, id: 'task-1', assigneeUserId: 'new-recipient' };
    const chain = { from: vi.fn(), where: vi.fn(), for: vi.fn(), limit: vi.fn(async () => [before]) };
    chain.from.mockReturnValue(chain); chain.where.mockReturnValue(chain); chain.for.mockReturnValue(chain);
    tx = { select: vi.fn(() => chain) } as unknown as LobeChatDatabase;
    transaction = vi.fn(async (fn: (runner: LobeChatDatabase) => Promise<unknown>) => {
      const saved = [...events];
      try { return await fn(tx); } catch (error) { events = saved; throw error; }
    });
    db = { transaction } as unknown as LobeChatDatabase;
    vi.spyOn(TaskModel.prototype, 'update').mockImplementation(async () => updated as never);
    vi.spyOn(TaskModel.prototype, 'addActivity').mockImplementation(async (data) => {
      const event = { ...data, id: `event-${events.length + 1}` } as TaskActivityItem;
      events.push(event); return event;
    });
    callback = vi.fn<NonNullable<Parameters<TaskModel['updateWithLog']>[3]>>(async () => {});
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Forbidden network'); }));
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('awaits the callback with the persisted event ID and the same transaction', async () => {
    const task = await new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { assigneeUserId: 'new-recipient' }, { userId: 'actor' }, callback);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'event-1', type: 'assignee_user', payload: { fromId: 'old-recipient', toId: 'new-recipient' } });
    expect(callback).toHaveBeenCalledWith(tx, events[0], task);
    expect(tx).not.toBe(db);
  });
  it('uses a new event for a subsequent legal reassignment', async () => {
    const model = new TaskModel(db, 'actor', 'ws-a');
    await model.updateWithLog('task-1', { assigneeUserId: 'new-recipient' }, {}, callback);
    before.assigneeUserId = 'new-recipient'; updated.assigneeUserId = 'old-recipient';
    await model.updateWithLog('task-1', { assigneeUserId: 'old-recipient' }, {}, callback);
    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
    expect(callback).toHaveBeenCalledTimes(2);
  });
  it('does not notify when saving the same assignee', async () => {
    before.assigneeUserId = 'new-recipient';
    await new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { assigneeUserId: 'new-recipient' }, {}, callback);
    expect(events).toHaveLength(0); expect(callback).not.toHaveBeenCalled();
  });
  it('does not notify for agent-only assignment changes', async () => {
    updated.assigneeUserId = before.assigneeUserId; updated.assigneeAgentId = 'agent-2';
    await new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { assigneeAgentId: 'agent-2' }, {}, callback);
    expect(events[0].type).toBe('assignee_agent'); expect(callback).not.toHaveBeenCalled();
  });
  it('rejects and rolls back the synthetic transaction when the callback rejects', async () => {
    const error = new Error('synthetic delivery failure'); callback.mockRejectedValue(error);
    await expect(new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { assigneeUserId: 'new-recipient' }, {}, callback)).rejects.toBe(error);
    expect(events).toHaveLength(0);
  });
  it('preserves the legacy call without a callback', async () => {
    await expect(new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { assigneeUserId: 'new-recipient' }, {})).resolves.toBe(updated);
    expect(events).toHaveLength(1);
  });
  it('preserves ordinary updates outside the assignment transaction', async () => {
    await new TaskModel(db, 'actor', 'ws-a').updateWithLog('task-1', { name: 'Renamed' }, {}, callback);
    expect(transaction).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
  });
});
