import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from './index';

const m = vi.hoisted(() => ({ activity: vi.fn(), create: vi.fn(), forbidden: vi.fn(), notify: vi.fn(), update: vi.fn() }));
vi.mock('@lobechat/database', () => ({ get serverDB() { return m.forbidden(); } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: m.forbidden }));
vi.mock('@lobechat/builtin-tool-task', () => ({ UNFINISHED_TASK_STATUSES: [] }));
vi.mock('@lobechat/const/rbac', () => ({ TASK_ASSIGNEE_PERMISSION_CODES: ['agent:update:all'] }));
vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: m.notify }));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/project', () => ({ ProjectModel: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class { hasAnyPermission = async () => true; } }));
vi.mock('@/database/models/workspaceMember', () => ({ WorkspaceMemberModel: class { getMemberForUpdate = async () => ({ role: 'member' }); } }));
vi.mock('@/database/models/task', () => ({
  TaskModel: class {
    constructor(private db: unknown, private user: string, private ws?: string) {}
    create(data: unknown, options?: unknown) { return m.create(this.db, this.user, this.ws, data, options); }
    addActivity(data: unknown) { return m.activity(this.db, this.user, this.ws, data); }
    updateWithLog(...args: unknown[]) { return m.update(this.db, this.user, this.ws, ...args); }
  },
  taskActivityActor: (actor: { userId: string }) => ({ actorKind: 'user', actorUserId: actor.userId, actorAgentId: null }),
  isTaskIdentifierUniqueViolation: () => false,
}));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));
vi.mock('@/database/models/verifyRun', () => ({ VerifyRunModel: vi.fn() }));
vi.mock('../aiAgent', () => ({ AiAgentService: m.forbidden }));
vi.mock('../file/extractFileIdsFromEditorData', () => ({ extractFileIdsFromEditorData: m.forbidden }));
vi.mock('../file/resolveAttachments', () => ({ resolveAttachmentMetadata: m.forbidden }));
vi.mock('../taskGraph', () => ({ TaskGraphService: m.forbidden }));
vi.mock('../taskReview', () => ({ TaskReviewService: m.forbidden }));
vi.mock('../taskRunner', () => ({ TaskRunnerService: m.forbidden }));
vi.mock('../taskScheduler', () => ({ createTaskSchedulerModule: m.forbidden }));
vi.mock('../verify/taskAcceptance', () => ({ resolveTaskAcceptance: m.forbidden }));
vi.mock('./collapseActivityLog', () => ({ collapseActivityLog: m.forbidden }));

describe('TaskService transactional notification wiring (mock models)', () => {
  let db: LobeChatDatabase;
  let tx: LobeChatDatabase;
  let tasks: unknown[];
  let events: unknown[];
  beforeEach(() => {
    vi.resetAllMocks(); tasks = []; events = [];
    m.forbidden.mockImplementation(() => { throw new Error('Forbidden side effect'); });
    vi.stubGlobal('fetch', m.forbidden);
    tx = { marker: 'transaction' } as unknown as LobeChatDatabase;
    db = { transaction: vi.fn(async (fn: (runner: LobeChatDatabase) => Promise<unknown>) => {
      const taskSave = [...tasks]; const eventSave = [...events];
      try { return await fn(tx); } catch (error) { tasks = taskSave; events = eventSave; throw error; }
    }) } as unknown as LobeChatDatabase;
    m.create.mockImplementation(async (_db, _user, _ws, data) => {
      const task = { ...data, id: 'task-1' }; tasks.push(task); return task;
    });
    m.activity.mockImplementation(async (_db, _user, _ws, data) => {
      const event = { ...data, id: 'event-1' }; events.push(event); return event;
    });
    m.notify.mockResolvedValue(undefined);
    m.update.mockImplementation(async (runner, _user, _ws, id, data, _actor, callback) => {
      const task = { id, assigneeUserId: data.assigneeUserId };
      await callback(runner, { id: 'persisted-update-event' }, task); return task;
    });
  });
  afterEach(() => { expect(m.forbidden).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it('persists the initial event and invokes the inbox writer in the task transaction', async () => {
    await new TaskService(db, 'creator', 'ws-a').createTask({ instruction: 'Synthetic', assigneeUserId: 'recipient' });
    expect(m.create).toHaveBeenCalledWith(tx, 'creator', 'ws-a', expect.any(Object), { maxRetries: 1 });
    expect(m.activity).toHaveBeenCalledWith(tx, 'creator', 'ws-a', expect.objectContaining({ type: 'assignee_user', taskId: 'task-1', payload: { actorKind: 'user', fromId: null, toId: 'recipient' } }));
    expect(m.notify).toHaveBeenCalledWith(tx, { actorUserId: 'creator', assigneeUserId: 'recipient', eventId: 'event-1', taskId: 'task-1', workspaceId: 'ws-a' });
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.activity.mock.invocationCallOrder[0]);
    expect(m.activity.mock.invocationCallOrder[0]).toBeLessThan(m.notify.mock.invocationCallOrder[0]);
  });
  it('does not report a committed task or event when notification persistence fails', async () => {
    const error = new Error('notification failed'); m.notify.mockRejectedValue(error);
    await expect(new TaskService(db, 'creator', 'ws-a').createTask({ instruction: 'Synthetic', assigneeUserId: 'recipient' })).rejects.toBe(error);
    expect(tasks).toHaveLength(0); expect(events).toHaveLength(0);
  });
  it('does not invoke notification if the task insert fails', async () => {
    m.create.mockRejectedValue(new Error('insert failed'));
    await expect(new TaskService(db, 'creator', 'ws-a').createTask({ instruction: 'Synthetic', assigneeUserId: 'recipient' })).rejects.toThrow('insert failed');
    expect(m.activity).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
  });
  it('wires reassignment to the model-provided persistent event and transaction', async () => {
    await new TaskService(db, 'creator', 'ws-b').updateTaskWithAssigneeLock('task-2', { assigneeUserId: 'recipient' }, { userId: 'creator' });
    expect(m.notify).toHaveBeenCalledWith(tx, { actorUserId: 'creator', assigneeUserId: 'recipient', eventId: 'persisted-update-event', taskId: 'task-2', workspaceId: 'ws-b' });
  });
  it('propagates reassignment notification failure', async () => {
    m.notify.mockRejectedValue(new Error('update receipt failed'));
    await expect(new TaskService(db, 'creator', 'ws-a').updateTaskWithAssigneeLock('task-1', { assigneeUserId: 'recipient' })).rejects.toThrow('update receipt failed');
  });
  it('keeps personal self-assignment silent without any new activity', async () => {
    await new TaskService(db, 'creator').createTask({ instruction: 'Personal', assigneeUserId: 'creator' });
    expect(m.notify).not.toHaveBeenCalled(); expect(m.activity).not.toHaveBeenCalled();
  });
  it('keeps unassigned creation silent', async () => {
    await new TaskService(db, 'creator', 'ws-a').createTask({ instruction: 'Unassigned' });
    expect(m.notify).not.toHaveBeenCalled(); expect(m.activity).not.toHaveBeenCalled();
  });
  it('does not notify when unassigning', async () => {
    await new TaskService(db, 'creator', 'ws-a').updateTaskWithAssigneeLock('task-1', { assigneeUserId: null });
    expect(m.notify).not.toHaveBeenCalled();
  });
});
