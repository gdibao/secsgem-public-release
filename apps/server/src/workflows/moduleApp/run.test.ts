// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trigger = vi.fn();

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com', INTERNAL_APP_URL: '' },
}));
vi.mock('@/libs/qstash', () => ({ workflowClient: { trigger } }));

describe('ModuleAppWorkflowDispatch', () => {
  beforeEach(() => {
    trigger.mockReset();
    trigger.mockResolvedValue({ workflowRunId: 'qstash-run-1' });
  });

  it('dispatches installation-scoped jobs with serial flow control', async () => {
    const { ModuleAppWorkflowDispatch } = await import('./index');
    await ModuleAppWorkflowDispatch.triggerRun({
      installationId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
    }, { workflowRunId: '00000000-0000-4000-8000-000000000002' });
    expect(trigger).toHaveBeenCalledWith({
      body: {
        installationId: '00000000-0000-4000-8000-000000000001',
        runId: '00000000-0000-4000-8000-000000000002',
      },
      flowControl: {
        key: 'module-app.run.00000000-0000-4000-8000-000000000001',
        parallelism: 1,
      },
      url: 'https://app.example.com/api/workflows/module-app/run',
      workflowRunId: '00000000-0000-4000-8000-000000000002',
    });
  });

  it('redispatches nonterminal jobs but stops at terminal state', async () => {
    const { runModuleAppWorkflowJob } = await import('./run');
    const dispatch = vi.fn();
    const engine = {
      executeClaimedNode: vi
        .fn()
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'succeeded' }),
    };
    const payload = {
      installationId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
    };
    await runModuleAppWorkflowJob({
      assertEntitlement: async () => undefined,
      dispatch,
      engine: engine as never,
      payload,
      workerId: 'worker-1',
    });
    await runModuleAppWorkflowJob({
      assertEntitlement: async () => undefined,
      dispatch,
      engine: engine as never,
      payload,
      workerId: 'worker-2',
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(payload);
  });

  it('rechecks entitlement before executing a claimed node', async () => {
    const { runModuleAppWorkflowJob } = await import('./run');
    const assertEntitlement = vi
      .fn()
      .mockRejectedValue(new Error('MODULE_APP_ENTITLEMENT_LICENSE_EXPIRED'));
    const engine = {
      executeClaimedNode: vi.fn().mockResolvedValue({ status: 'running' }),
      fail: vi.fn().mockResolvedValue({
        errorCode: 'MODULE_APP_WORKFLOW_ENTITLEMENT_DENIED',
        status: 'failed',
      }),
    };

    await expect(
      runModuleAppWorkflowJob({
        assertEntitlement,
        dispatch: vi.fn(),
        engine: engine as never,
        payload: {
          installationId: '00000000-0000-4000-8000-000000000001',
          runId: '00000000-0000-4000-8000-000000000002',
        },
        workerId: 'worker-1',
      }),
    ).resolves.toMatchObject({
      errorCode: 'MODULE_APP_WORKFLOW_ENTITLEMENT_DENIED',
      status: 'failed',
    });
    expect(assertEntitlement).toHaveBeenCalledOnce();
    expect(engine.executeClaimedNode).not.toHaveBeenCalled();
    expect(engine.fail).toHaveBeenCalledWith({
      errorCode: 'MODULE_APP_WORKFLOW_ENTITLEMENT_DENIED',
      installationId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
    });
  });

  it('propagates infrastructure failures while resolving entitlement', async () => {
    const { runModuleAppWorkflowJob } = await import('./run');
    const engine = {
      executeClaimedNode: vi.fn(),
      fail: vi.fn(),
    };

    await expect(
      runModuleAppWorkflowJob({
        assertEntitlement: async () => {
          throw new Error('database unavailable');
        },
        dispatch: vi.fn(),
        engine: engine as never,
        payload: {
          installationId: '00000000-0000-4000-8000-000000000001',
          runId: '00000000-0000-4000-8000-000000000002',
        },
        workerId: 'worker-1',
      }),
    ).rejects.toThrow('database unavailable');
    expect(engine.fail).not.toHaveBeenCalled();
  });
});
