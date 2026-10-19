import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDispatch } from '../scheduleDispatch';

const mocks = vi.hoisted(() => ({
  dispatchDueModuleAppSchedules: vi.fn(),
  getScheduledTasks: vi.fn(),
  getServerDB: vi.fn(),
  isExecutionTime: vi.fn(),
  publishJSON: vi.fn(),
  runScheduleTick: vi.fn(),
}));

vi.mock('@lobechat/utils/cronEval', () => ({ isExecutionTime: mocks.isExecutionTime }));
vi.mock('@/database/models/task', () => ({
  TaskModel: { getScheduledTasks: mocks.getScheduledTasks },
}));
vi.mock('@/database/server', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/envs/app', () => ({ appEnv: { enableQueueAgentRuntime: false } }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: mocks.publishJSON } }));
vi.mock('@/server/services/taskRunner/scheduleTick', () => ({
  runScheduleTick: mocks.runScheduleTick,
}));
vi.mock('@/server/workflows/moduleApp/scheduleDispatcher', () => ({
  dispatchDueModuleAppSchedules: mocks.dispatchDueModuleAppSchedules,
}));

const createApp = () => {
  const app = new Hono();
  app.post('/schedule-dispatch', scheduleDispatch);
  return app;
};

const dispatch = (body?: unknown) =>
  createApp().request('/schedule-dispatch', {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const scheduledTask = {
  createdByUserId: 'user-1',
  id: 'task-1',
  identifier: 'daily-report',
  lastHeartbeatAt: null,
  schedulePattern: '* * * * *',
  scheduleTimezone: 'UTC',
};

describe('scheduleDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({ id: 'db' });
    mocks.getScheduledTasks.mockResolvedValue([scheduledTask]);
    mocks.isExecutionTime.mockReturnValue(true);
    mocks.runScheduleTick.mockResolvedValue({ ran: true, taskIdentifier: 'daily-report' });
    mocks.dispatchDueModuleAppSchedules.mockResolvedValue({
      bookkeepingFailed: 0,
      claimed: 2,
      dispatched: 1,
      failed: 1,
    });
  });

  it('dispatches ordinary tasks and Module App schedules from the same production tick', async () => {
    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({
      dispatched: 1,
      moduleApps: {
        bookkeepingFailed: 0,
        claimed: 2,
        dispatched: 1,
        failed: 1,
        status: 'completed',
      },
      success: true,
    });
    expect(mocks.runScheduleTick).toHaveBeenCalledWith('task-1', 'user-1');
    expect(mocks.dispatchDueModuleAppSchedules).toHaveBeenCalledWith({ db: { id: 'db' } });
  });

  it('still runs Module App scheduling when no ordinary task is due', async () => {
    mocks.isExecutionTime.mockReturnValue(false);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({
      dispatched: 0,
      due: 0,
      moduleApps: { claimed: 2, status: 'completed' },
    });
    expect(mocks.runScheduleTick).not.toHaveBeenCalled();
    expect(mocks.dispatchDueModuleAppSchedules).toHaveBeenCalledOnce();
  });

  it('keeps the ordinary dispatch successful when Module App scheduling fails', async () => {
    mocks.dispatchDueModuleAppSchedules.mockRejectedValue(new Error('database unavailable'));

    const response = await dispatch();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dispatched: 1,
      moduleApps: {
        bookkeepingFailed: 0,
        claimed: 0,
        dispatched: 0,
        error: 'database unavailable',
        failed: 0,
        status: 'failed',
      },
      success: true,
    });
    expect(mocks.runScheduleTick).toHaveBeenCalledOnce();
  });

  it('does not claim Module App schedules during a dry run', async () => {
    const response = await dispatch({ dryRun: true });

    await expect(response.json()).resolves.toMatchObject({
      dispatched: 0,
      dryRun: true,
      moduleApps: {
        claimed: 0,
        reason: 'dry-run',
        status: 'skipped',
      },
    });
    expect(mocks.runScheduleTick).not.toHaveBeenCalled();
    expect(mocks.dispatchDueModuleAppSchedules).not.toHaveBeenCalled();
  });

  it('reports the backend switch as disabled without failing the central tick', async () => {
    mocks.dispatchDueModuleAppSchedules.mockRejectedValue(
      new Error('MODULE_APP_SCHEDULE_DISPATCH_DISABLED'),
    );

    const response = await dispatch();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dispatched: 1,
      moduleApps: {
        bookkeepingFailed: 0,
        claimed: 0,
        dispatched: 0,
        failed: 0,
        status: 'disabled',
      },
      success: true,
    });
  });
});
