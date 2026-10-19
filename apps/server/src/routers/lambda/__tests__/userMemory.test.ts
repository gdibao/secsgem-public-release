import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UserPersonaVersionNotFoundError,
  UserPersonaVersionSnapshotMissingError,
} from '@/database/models/userMemory/persona';
import { userMemoryRouter } from '@/server/routers/lambda/userMemory';
import { AsyncTaskErrorType, AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import { MemorySourceType } from '@/types/userMemory';

const mockFindActiveByType = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockFindById = vi.fn();

const mockCountTopicsForMemoryExtractor = vi.fn();
const mockDeleteAll = vi.fn();
const mockDeletePersona = vi.fn();
const mockResetMemoryExtractStatus = vi.fn();
const {
  mockExecutorCreate,
  mockExecutorGetTopicsForUser,
  mockExecutorRunDirect,
  mockGetAppSettingValue,
  mockTriggerProcessUsers,
} = vi.hoisted(() => ({
  mockExecutorCreate: vi.fn(),
  mockExecutorGetTopicsForUser: vi.fn(),
  mockExecutorRunDirect: vi.fn(),
  mockGetAppSettingValue: vi.fn(),
  mockTriggerProcessUsers: vi.fn(),
}));

const mockListPersonaVersions = vi.fn();
const mockRestorePersonaVersion = vi.fn();

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(function () {
    return {
      create: mockCreate,
      findById: mockFindById,
      findActiveByType: mockFindActiveByType,
      update: mockUpdate,
    };
  }),
  initUserMemoryExtractionMetadata: vi.fn(function (metadata) {
    return metadata;
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return {
      countTopicsForMemoryExtractor: mockCountTopicsForMemoryExtractor,
      resetMemoryExtractStatus: mockResetMemoryExtractStatus,
    };
  }),
}));

vi.mock('@/database/models/userMemory', () => ({
  UserMemoryActivityModel: vi.fn(function () {
    return {};
  }),
  UserMemoryContextModel: vi.fn(function () {
    return {};
  }),
  UserMemoryExperienceModel: vi.fn(function () {
    return {};
  }),
  UserMemoryIdentityModel: vi.fn(function () {
    return {};
  }),
  UserMemoryModel: vi.fn(function () {
    return {
      deleteAll: mockDeleteAll,
    };
  }),
  UserMemoryPreferenceModel: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaVersionNotFoundError: class UserPersonaVersionNotFoundError extends Error {},
  UserPersonaVersionSnapshotMissingError: class UserPersonaVersionSnapshotMissingError extends Error {},
  UserPersonaModel: vi.fn(function () {
    return {
      deletePersona: mockDeletePersona,
      listVersions: mockListPersonaVersions,
      restoreVersion: mockRestorePersonaVersion,
    };
  }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
    INTERNAL_APP_URL: 'https://internal.example.com',
  },
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: vi.fn(function () {
    return {
      webhook: { baseUrl: 'https://internal.example.com' },
      upstashWorkflowExtraHeaders: { 'x-test': 'ok' },
    };
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionExecutor: {
    create: mockExecutorCreate,
  },
  MemoryExtractionWorkflowService: {
    triggerProcessUsers: mockTriggerProcessUsers,
  },
  buildWorkflowPayloadInput: (payload: any) => payload,
  normalizeMemoryExtractionPayload: (payload: any) => payload,
}));

vi.mock('@/server/services/appSettings', () => ({
  APP_SETTING_KEYS: {
    memoryUserMemoryTriggerMode: 'memory.userMemory.triggerMode',
  },
  getAppSettingValue: mockGetAppSettingValue,
}));

const createCaller = (ctxOverrides: Partial<any> = {}) => {
  const ctx = {
    serverDB: {} as any,
    userId: 'user-1',
    ...ctxOverrides,
  };

  return userMemoryRouter.createCaller(ctx);
};

describe('userMemoryRouter.requestMemoryFromChatTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutorCreate.mockReset();
    mockExecutorGetTopicsForUser.mockReset();
    mockExecutorRunDirect.mockReset();
    mockGetAppSettingValue.mockReset();
    mockTriggerProcessUsers.mockReset();
    delete process.env.MEMORY_USER_MEMORY_TRIGGER_MODE;
    process.env.QSTASH_TOKEN = 'test-qstash-token';
    mockExecutorCreate.mockResolvedValue({
      getTopicsForUser: mockExecutorGetTopicsForUser,
      runDirect: mockExecutorRunDirect,
    });
    mockExecutorGetTopicsForUser.mockResolvedValue({ ids: [] });
    mockExecutorRunDirect.mockResolvedValue({ processed: 0, results: [] });
    mockGetAppSettingValue.mockResolvedValue(null);
    mockTriggerProcessUsers.mockResolvedValue({ workflowRunId: 'workflow-run-1' });
  });

  it('dedupes when an active task exists', async () => {
    mockFindActiveByType.mockResolvedValue({
      id: 'existing-task',
      metadata: { progress: { completedTopics: 0, totalTopics: 1 } },
      status: AsyncTaskStatus.Pending,
    });

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toEqual({
      deduped: true,
      id: 'existing-task',
      metadata: { progress: { completedTopics: 0, totalTopics: 1 } },
      status: AsyncTaskStatus.Pending,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
  });

  it('creates task and triggers workflow with user context and dates', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue('new-task');
    mockCountTopicsForMemoryExtractor.mockResolvedValue(2);

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({
      fromDate: new Date('2024-01-01'),
      toDate: new Date('2024-02-01'),
    });

    expect(mockCreate).toHaveBeenCalledWith({
      metadata: {
        progress: { completedTopics: 0, totalTopics: 2 },
        range: {
          from: new Date('2024-01-01').toISOString(),
          to: new Date('2024-02-01').toISOString(),
        },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
    });
    expect(mockTriggerProcessUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        asyncTaskId: 'new-task',
        baseUrl: 'https://internal.example.com',
        fromDate: new Date('2024-01-01'),
        sources: [MemorySourceType.ChatTopic],
        toDate: new Date('2024-02-01'),
        userIds: ['user-1'],
        userInitiated: true,
      }),
      { extraHeaders: { 'x-test': 'ok' } },
    );
    expect(mockUpdate).toHaveBeenCalledWith('new-task', {
      metadata: expect.objectContaining({
        control: {
          upstash: {
            workflowRunIds: ['workflow-run-1'],
          },
        },
      }),
    });
    expect(result).toMatchObject({
      deduped: false,
      id: 'new-task',
      status: AsyncTaskStatus.Pending,
    });
  });

  it('returns success immediately when no topics', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCountTopicsForMemoryExtractor.mockResolvedValue(0);
    mockCreate.mockResolvedValue('empty-task');

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toEqual({
      deduped: false,
      id: 'empty-task',
      metadata: {
        progress: { completedTopics: 0, totalTopics: 0 },
        range: { from: undefined, to: undefined },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Success,
    });
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
  });

  it('falls back to direct extraction when QStash token is not configured', async () => {
    delete process.env.QSTASH_TOKEN;
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue('direct-task');
    mockCountTopicsForMemoryExtractor.mockResolvedValue(2);
    mockExecutorGetTopicsForUser
      .mockResolvedValueOnce({ ids: ['topic-1', 'topic-2'] })
      .mockResolvedValueOnce({ ids: [] });

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toMatchObject({
      deduped: false,
      id: 'direct-task',
      status: AsyncTaskStatus.Pending,
    });
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockExecutorCreate).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(mockExecutorRunDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          asyncTaskId: 'direct-task',
          mode: 'direct',
          sources: [MemorySourceType.ChatTopic],
          topicIds: ['topic-1', 'topic-2'],
          userIds: ['user-1'],
          userInitiated: true,
        }),
      );
    });
  });

  it('uses direct extraction when the admin memory setting forces direct mode', async () => {
    process.env.QSTASH_TOKEN = 'test-qstash-token';
    mockGetAppSettingValue.mockResolvedValue('direct');
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue('direct-task');
    mockCountTopicsForMemoryExtractor.mockResolvedValue(1);
    mockExecutorGetTopicsForUser
      .mockResolvedValueOnce({ ids: ['topic-1'] })
      .mockResolvedValueOnce({ ids: [] });

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toMatchObject({
      id: 'direct-task',
      status: AsyncTaskStatus.Pending,
    });
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockExecutorRunDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'direct',
          topicIds: ['topic-1'],
        }),
      );
    });
  });

  it('throws on invalid date range', async () => {
    const caller = createCaller();
    await expect(
      caller.requestMemoryFromChatTopic({
        fromDate: new Date('2024-02-02'),
        toDate: new Date('2024-01-01'),
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('userMemoryRouter.getMemoryExtractionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('returns null when no active task', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask();

    expect(result).toBeNull();
  });

  it('returns active task with normalized metadata', async () => {
    mockFindActiveByType.mockResolvedValue({
      id: 'task-1',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 4 },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Processing,
      userId: 'user-1',
    });

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask();

    expect(result).toEqual({
      error: undefined,
      id: 'task-1',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 4 },
        range: undefined,
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Processing,
    });
  });

  it('fetches by task id when provided', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockFindById.mockResolvedValue({
      id: 'a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0',
      metadata: {
        progress: { completedTopics: 2, totalTopics: 8 },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Pending,
      userId: 'user-1',
    });

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask({
      taskId: 'a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0',
    });

    expect(mockFindById).toHaveBeenCalledWith('a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0');
    expect(result?.id).toBe('a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0');
  });

  it('marks active task as error when topic-based timeout is exceeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-01T01:00:00.000Z'));

    mockFindActiveByType.mockResolvedValue({
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      id: 'task-timeout',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 6 },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Processing,
      userId: 'user-1',
    });

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask();

    expect(mockUpdate).toHaveBeenCalledWith(
      'task-timeout',
      expect.objectContaining({
        error: expect.objectContaining({
          body: expect.objectContaining({
            detail: expect.stringContaining('timed out after 30 minutes'),
          }),
          name: AsyncTaskErrorType.Timeout,
        }),
        status: AsyncTaskStatus.Error,
      }),
    );
    expect(result).toEqual({
      error: expect.objectContaining({
        body: expect.objectContaining({
          detail: expect.stringContaining('timed out after 30 minutes'),
        }),
        name: AsyncTaskErrorType.Timeout,
      }),
      id: 'task-timeout',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 6 },
        range: undefined,
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Error,
    });
  });
});

describe('userMemoryRouter.deleteAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges all user memories through the aggregate model', async () => {
    mockDeleteAll.mockResolvedValue(undefined);
    mockDeletePersona.mockResolvedValue(undefined);
    mockResetMemoryExtractStatus.mockResolvedValue(undefined);

    const caller = createCaller();
    const result = await caller.deleteAll();

    expect(mockDeleteAll).toHaveBeenCalledOnce();
    expect(mockDeletePersona).toHaveBeenCalledOnce();
    expect(mockResetMemoryExtractStatus).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true });
  });
});

describe('userMemoryRouter persona versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the caller persona history projection', async () => {
    const versions = [
      {
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        id: 'history-1',
        nextVersion: 2,
        previousVersion: 1,
        snapshotPersona: '# Persona',
        snapshotTagline: 'Tagline',
      },
    ];
    mockListPersonaVersions.mockResolvedValue(versions);

    await expect(createCaller().listPersonaVersions()).resolves.toEqual(versions);
    expect(mockListPersonaVersions).toHaveBeenCalledWith();
  });

  it('restores a historical snapshot as a new persona version', async () => {
    mockRestorePersonaVersion.mockResolvedValue({ document: { version: 4 } });

    await expect(createCaller().restorePersonaVersion({ historyId: 'history-1' })).resolves.toEqual(
      { historyId: 'history-1', personaVersion: 4 },
    );
    expect(mockRestorePersonaVersion).toHaveBeenCalledWith('history-1');
  });

  it('maps an unavailable persona version to not found', async () => {
    mockRestorePersonaVersion.mockRejectedValue(new UserPersonaVersionNotFoundError());

    await expect(
      createCaller().restorePersonaVersion({ historyId: 'history-missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps a missing persona snapshot to a failed precondition', async () => {
    mockRestorePersonaVersion.mockRejectedValue(new UserPersonaVersionSnapshotMissingError());

    await expect(
      createCaller().restorePersonaVersion({ historyId: 'history-incomplete' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it.each(['listPersonaVersions', 'restorePersonaVersion'] as const)(
    'rejects %s in workspace scope',
    async (procedure) => {
      const caller = createCaller({ workspaceId: 'workspace-1' });
      const operation =
        procedure === 'listPersonaVersions'
          ? caller.listPersonaVersions()
          : caller.restorePersonaVersion({ historyId: 'history-1' });

      await expect(operation).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );
});
