import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from './index';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  activity: vi.fn(),
  forbidden: vi.fn(() => {
    throw new Error('Real database, network or runtime access is forbidden');
  }),
  manageable: vi.fn(),
  member: vi.fn(),
  permission: vi.fn(),
  project: vi.fn(),
  projectConstructor: vi.fn(),
  rbacConstructor: vi.fn(),
  resolve: vi.fn(),
  taskConstructor: vi.fn(),
  workspaceConstructor: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({ get serverDB() { return mocks.forbidden(); } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.forbidden }));
vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@lobechat/builtin-tool-task', () => ({ UNFINISHED_TASK_STATUSES: [] }));
vi.mock('@lobechat/const/rbac', () => ({
  TASK_ASSIGNEE_PERMISSION_CODES: ['agent:update:all', 'agent:update:owner'],
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function (db, userId, workspaceId) {
    mocks.projectConstructor(db, userId, workspaceId);
    return {
      findById: (id: string) => mocks.project(db, userId, workspaceId, id),
      findManageableById: (id: string) => mocks.manageable(db, userId, workspaceId, id),
    };
  }),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: vi.fn(function (db, userId) {
    mocks.rbacConstructor(db, userId);
    return { hasAnyPermission: (...args: unknown[]) => mocks.permission(db, userId, ...args) };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function (db, userId, workspaceId) {
    mocks.taskConstructor(db, userId, workspaceId);
    return {
      addActivity: (...args: unknown[]) => mocks.activity(db, userId, workspaceId, ...args),
      create: (...args: unknown[]) => mocks.create(db, userId, workspaceId, ...args),
      resolve: (id: string) => mocks.resolve(db, userId, workspaceId, id),
    };
  }),
  isTaskIdentifierUniqueViolation: (error: unknown) =>
    error instanceof Error && error.message === 'synthetic-identifier-conflict',
  taskActivityActor: (actor: { userId: string }) => ({ actorKind: 'user', actorUserId: actor.userId, actorAgentId: null }),
}));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));
vi.mock('@/database/models/verifyRun', () => ({ VerifyRunModel: vi.fn() }));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function (db, userId) {
    mocks.workspaceConstructor(db, userId);
    return {
      getMember: mocks.forbidden,
      getMemberForUpdate: (...args: unknown[]) => mocks.member(db, ...args),
    };
  }),
}));
vi.mock('../aiAgent', () => ({ AiAgentService: mocks.forbidden }));
vi.mock('../file/extractFileIdsFromEditorData', () => ({ extractFileIdsFromEditorData: mocks.forbidden }));
vi.mock('../file/resolveAttachments', () => ({ resolveAttachmentMetadata: mocks.forbidden }));
vi.mock('../taskGraph', () => ({ TaskGraphService: mocks.forbidden }));
vi.mock('../taskReview', () => ({ TaskReviewService: mocks.forbidden }));
vi.mock('../taskRunner', () => ({ TaskRunnerService: mocks.forbidden }));
vi.mock('../taskScheduler', () => ({ createTaskSchedulerModule: mocks.forbidden }));
vi.mock('../verify/taskAcceptance', () => ({ resolveTaskAcceptance: mocks.forbidden }));
vi.mock('./collapseActivityLog', () => ({ collapseActivityLog: mocks.forbidden }));

describe('TaskService assignment project access (mock models, no database)', () => {
  const creator = 'creator-a';
  const recipient = 'recipient-b';
  let events: string[];
  let transactions: LobeChatDatabase[];
  let projects: Map<string, { identifier: string; userId: string; visibility: string | null; workspaceId: string | null }>;
  let db: LobeChatDatabase;
  let transaction: ReturnType<typeof vi.fn>;

  const input = () => ({ assigneeUserId: recipient, instruction: 'Synthetic task', projectId: 'project-a' });
  const service = (workspaceId: string | undefined = 'workspace-a') => new TaskService(db, creator, workspaceId);
  const conflict = () => new Error('synthetic-identifier-conflict');

  beforeEach(() => {
    vi.resetAllMocks();
    events = [];
    transactions = [];
    projects = new Map([
      ['project-a', { identifier: 'AAA', userId: creator, visibility: 'public', workspaceId: 'workspace-a' }],
      ['project-b', { identifier: 'BBB', userId: creator, visibility: 'public', workspaceId: 'workspace-b' }],
    ]);
    mocks.forbidden.mockImplementation(() => { throw new Error('Forbidden side effect'); });
    vi.stubGlobal('fetch', mocks.forbidden);
    transaction = vi.fn(async (callback: (tx: LobeChatDatabase) => unknown) => {
      const tx = { testTransaction: transactions.length + 1 } as unknown as LobeChatDatabase;
      transactions.push(tx);
      return callback(tx);
    });
    db = { transaction } as unknown as LobeChatDatabase;
    mocks.manageable.mockImplementation(async (_db, userId, workspaceId, id) => {
      const project = projects.get(id);
      return project?.userId === userId && project!.workspaceId === (workspaceId ?? null) ? project : null;
    });
    mocks.member.mockImplementation(async () => { events.push('member-lock'); return { role: 'member' }; });
    mocks.permission.mockImplementation(async () => { events.push('rbac'); return true; });
    // This fixture models the existing rule; it does not execute ProjectModel SQL.
    mocks.project.mockImplementation(async (_db, userId, workspaceId, id) => {
      events.push('project-read');
      const project = projects.get(id);
      return project?.workspaceId === workspaceId &&
        (project!.visibility === null || project!.visibility === 'public' || project!.userId === userId)
        ? project : null;
    });
    mocks.create.mockImplementation(async (_db, _userId, _workspaceId, data) => {
      events.push('create');
      return { ...data, id: 'synthetic-task' };
    });
    mocks.activity.mockResolvedValue({ id: 'synthetic-event' });
    mocks.resolve.mockResolvedValue({ id: 'parent', projectId: 'project-a', visibility: 'public' });
  });

  afterEach(() => {
    expect(mocks.forbidden).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(['workspace-a', 'workspace-b'])('uses the recipient and same transaction in %s, but creates as the creator', async (workspaceId) => {
    const projectId = workspaceId === 'workspace-a' ? 'project-a' : 'project-b';
    await service(workspaceId).createTask({ ...input(), projectId });
    const tx = transactions[0];
    expect(tx).not.toBe(db);
    expect(events).toEqual(['member-lock', 'rbac', 'project-read', 'create']);
    expect(mocks.workspaceConstructor).toHaveBeenCalledWith(tx, creator);
    expect(mocks.member).toHaveBeenCalledWith(tx, workspaceId, recipient);
    expect(mocks.rbacConstructor).toHaveBeenCalledWith(tx, recipient);
    expect(mocks.permission).toHaveBeenCalledWith(tx, recipient, ['agent:update:all', 'agent:update:owner'], { userId: recipient, workspaceId });
    expect(mocks.projectConstructor).toHaveBeenCalledWith(tx, recipient, workspaceId);
    expect(mocks.project).toHaveBeenCalledWith(tx, recipient, workspaceId, projectId);
    expect(mocks.manageable).toHaveBeenCalledWith(db, creator, workspaceId, projectId);
    expect(mocks.taskConstructor).toHaveBeenLastCalledWith(tx, creator, workspaceId);
    expect(mocks.create).toHaveBeenCalledWith(tx, creator, workspaceId, expect.objectContaining({ projectId }), { maxRetries: 1 });
  });

  it('allows historical null project visibility', async () => {
    projects.get('project-a')!.visibility = null;
    await service().createTask(input());
    expect(mocks.project).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('allows own private project with creator and recipient equal', async () => {
    projects.get('project-a')!.visibility = 'private';
    await service().createTask({ ...input(), assigneeUserId: creator, visibility: 'private' });
    expect(mocks.project).toHaveBeenCalledWith(transactions[0], creator, 'workspace-a', 'project-a');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each(['private', 'cross-workspace', 'missing'])('rejects a project becoming %s after creator authorization', async (kind) => {
    mocks.permission.mockImplementation(async () => {
      if (kind === 'private') projects.get('project-a')!.visibility = 'private';
      else if (kind === 'cross-workspace') projects.get('project-a')!.workspaceId = 'workspace-b';
      else projects.delete('project-a');
      return true;
    });
    await expect(service().createTask(input())).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Project not found' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an already private project owned by someone other than the recipient', async () => {
    projects.get('project-a')!.visibility = 'private';
    await expect(service().createTask(input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([true, false])('checks inherited projectId, readable=%s', async (readable) => {
    if (!readable) projects.get('project-a')!.visibility = 'private';
    const result = service().createTask({ assigneeUserId: recipient, instruction: 'Child', parentTaskId: 'PARENT-1' });
    if (readable) await expect(result).resolves.toMatchObject({ projectId: 'project-a' });
    else await expect(result).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.project).toHaveBeenCalledWith(transactions[0], recipient, 'workspace-a', 'project-a');
    expect(mocks.create).toHaveBeenCalledTimes(readable ? 1 : 0);
  });

  it('rejects creator access before checking recipient or creating', async () => {
    projects.get('project-a')!.userId = 'another-owner';
    await expect(service().createTask(input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['member-revoked', 'rbac-denied'])('does not read project or create on %s', async (reason) => {
    if (reason === 'member-revoked') mocks.member.mockResolvedValue(null);
    else mocks.permission.mockResolvedValue(false);
    await expect(service().createTask(input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    if (reason === 'member-revoked') expect(mocks.permission).not.toHaveBeenCalled();
  });

  it('propagates project database failure without retry or create', async () => {
    const error = new Error('synthetic-database-failure');
    mocks.project.mockRejectedValue(error);
    await expect(service().createTask(input())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preserves personal self-assignment without recipient project lookup', async () => {
    projects.get('project-a')!.workspaceId = null;
    await new TaskService(db, creator).createTask({ ...input(), assigneeUserId: creator });
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(db, creator, undefined, expect.objectContaining({ projectId: 'project-a' }));
  });

  it('preserves personal rejection when assigning another user', async () => {
    await expect(new TaskService(db, creator).createTask({ assigneeUserId: recipient, instruction: 'Personal' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it('preserves member lock and RBAC for an assigned task with no project', async () => {
    await service().createTask({ assigneeUserId: recipient, instruction: 'No project' });
    expect(events).toEqual(['member-lock', 'rbac', 'create']);
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it('preserves unassigned project creation without recipient lookup', async () => {
    await service().createTask({ instruction: 'Unassigned', projectId: 'project-a' });
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('preserves the private task restriction', async () => {
    await expect(service().createTask({ ...input(), visibility: 'private' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rechecks permissions in every new transaction on identifier conflict', async () => {
    mocks.create.mockImplementationOnce(async () => { events.push('create'); throw conflict(); });
    await service().createTask(input());
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).not.toBe(transactions[1]);
    expect(events).toEqual(['member-lock', 'rbac', 'project-read', 'create', 'member-lock', 'rbac', 'project-read', 'create']);
    for (const tx of transactions) {
      expect(mocks.project).toHaveBeenCalledWith(tx, recipient, 'workspace-a', 'project-a');
      expect(mocks.create).toHaveBeenCalledWith(tx, creator, 'workspace-a', expect.any(Object), { maxRetries: 1 });
    }
  });

  it('stops a retry when project access has been revoked', async () => {
    mocks.create.mockImplementationOnce(async () => {
      projects.get('project-a')!.visibility = 'private';
      throw conflict();
    });
    await expect(service().createTask(input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(mocks.member).toHaveBeenCalledTimes(2);
    expect(mocks.permission).toHaveBeenCalledTimes(2);
    expect(mocks.project).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('retains the five-attempt bound and one create attempt per transaction', async () => {
    mocks.create.mockRejectedValue(conflict());
    await expect(service().createTask(input())).rejects.toThrow('synthetic-identifier-conflict');
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(mocks.member).toHaveBeenCalledTimes(5);
    expect(mocks.permission).toHaveBeenCalledTimes(5);
    expect(mocks.project).toHaveBeenCalledTimes(5);
    expect(mocks.create).toHaveBeenCalledTimes(5);
    for (const call of mocks.create.mock.calls) expect(call[4]).toEqual({ maxRetries: 1 });
  });
});
