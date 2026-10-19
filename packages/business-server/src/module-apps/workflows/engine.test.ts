import { moduleAppWorkflowDefinitionSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppWorkflowEngine } from './engine';

const INSTALLATION_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '00000000-0000-4000-8000-000000000002';
const workflow = moduleAppWorkflowDefinitionSchema.parse({
  edges: [
    { from: 'load', to: 'approval' },
    { from: 'approval', to: 'finish' },
  ],
  key: 'candidate_review',
  nodes: [
    { config: { functionKey: 'load_candidate' }, key: 'load', type: 'function' },
    { config: {}, key: 'approval', type: 'approval' },
    { config: {}, key: 'finish', type: 'transform' },
  ],
  startNodeKey: 'load',
  version: 1,
});

const run = {
  context: { input: { candidateId: 'candidate-1' }, workflow },
  id: RUN_ID,
  installationId: INSTALLATION_ID,
  status: 'running' as const,
};

const createRepository = () => ({
  cancelRun: vi.fn().mockResolvedValue({ ...run, status: 'cancelled' }),
  claimRunnableNode: vi.fn(),
  completeNode: vi.fn().mockResolvedValue({ status: 'succeeded' }),
  createRun: vi.fn().mockResolvedValue({ ...run, status: 'queued' }),
  getRun: vi.fn().mockResolvedValue(run),
  listNodes: vi.fn(),
  markNodeWaiting: vi.fn().mockResolvedValue({ status: 'waiting' }),
  queueNodes: vi.fn().mockResolvedValue([]),
  resumeNode: vi.fn().mockResolvedValue({ status: 'succeeded' }),
  retryOrFailNode: vi.fn(),
  skipNodes: vi.fn().mockResolvedValue([]),
  updateRunStatus: vi.fn().mockResolvedValue(run),
});

describe('ModuleAppWorkflowEngine', () => {
  it('persists start input, waits without a worker, resumes, and finishes', async () => {
    const repository = createRepository();
    repository.claimRunnableNode
      .mockResolvedValueOnce({
        attempt: 1,
        inputSummary: { candidateId: 'candidate-1' },
        nodeKey: 'load',
        runId: RUN_ID,
        workerId: 'w1',
      })
      .mockResolvedValueOnce({
        attempt: 1,
        inputSummary: { candidate: { name: 'A' } },
        nodeKey: 'approval',
        runId: RUN_ID,
        workerId: 'w1',
      })
      .mockResolvedValueOnce({
        attempt: 1,
        inputSummary: { approved: true },
        nodeKey: 'finish',
        runId: RUN_ID,
        workerId: 'w1',
      });
    repository.listNodes
      .mockResolvedValueOnce([
        { nodeKey: 'load', outputSummary: { candidate: { name: 'A' } }, status: 'succeeded' },
        { nodeKey: 'approval', status: 'pending' },
        { nodeKey: 'finish', status: 'pending' },
      ])
      .mockResolvedValueOnce([
        { nodeKey: 'load', status: 'succeeded' },
        { nodeKey: 'approval', outputSummary: { approved: true }, status: 'succeeded' },
        { nodeKey: 'finish', status: 'pending' },
      ])
      .mockResolvedValueOnce([
        { nodeKey: 'load', status: 'succeeded' },
        { nodeKey: 'approval', status: 'succeeded' },
        { nodeKey: 'finish', outputSummary: { done: true }, status: 'succeeded' },
      ]);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ output: { candidate: { name: 'A' } } })
      .mockResolvedValueOnce({ output: { done: true } });
    const engine = new ModuleAppWorkflowEngine({ execute, repository });

    await engine.start({
      idempotencyKey: 'install:action:request',
      input: { candidateId: 'candidate-1' },
      installationId: INSTALLATION_ID,
      workflow,
    });
    expect(repository.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { input: { candidateId: 'candidate-1' }, workflow },
        nodes: expect.arrayContaining([
          expect.objectContaining({ inputSummary: { candidateId: 'candidate-1' }, key: 'load', status: 'queued' }),
          expect.objectContaining({ key: 'approval', status: 'pending' }),
        ]),
      }),
    );

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `${RUN_ID}:load:1` }),
    );
    expect(repository.queueNodes).toHaveBeenCalledWith(
      expect.objectContaining({ nodeInputs: { approval: { candidate: { name: 'A' } } } }),
    );

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(repository.markNodeWaiting).toHaveBeenCalledWith(
      expect.objectContaining({ nodeKey: 'approval', runId: RUN_ID }),
    );
    await engine.resume({
      installationId: INSTALLATION_ID,
      nodeKey: 'approval',
      runId: RUN_ID,
      value: { approved: true },
    });
    expect(repository.queueNodes).toHaveBeenCalledWith(
      expect.objectContaining({ nodeInputs: { finish: { approved: true } } }),
    );

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(repository.updateRunStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('uses bounded retry delays and does not execute duplicate dispatches', async () => {
    const repository = createRepository();
    repository.claimRunnableNode
      .mockResolvedValueOnce({ attempt: 2, inputSummary: {}, nodeKey: 'load', runId: RUN_ID, workerId: 'w1' })
      .mockResolvedValueOnce(null);
    repository.retryOrFailNode.mockResolvedValueOnce({ status: 'queued' });
    const execute = vi.fn().mockRejectedValue(new Error('temporary'));
    const engine = new ModuleAppWorkflowEngine({ execute, repository });

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(repository.retryOrFailNode).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 2000, errorCode: 'MODULE_APP_WORKFLOW_NODE_FAILED' }),
    );
    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('queues compensation after retry exhaustion', async () => {
    const compensated = moduleAppWorkflowDefinitionSchema.parse({
      edges: [{ from: 'load', to: 'cleanup' }],
      key: 'compensated',
      nodes: [
        { compensationNodeKey: 'cleanup', config: {}, key: 'load', type: 'function' },
        { config: {}, key: 'cleanup', type: 'function' },
      ],
      startNodeKey: 'load',
      version: 1,
    });
    const repository = createRepository();
    repository.getRun.mockResolvedValue({ ...run, context: { input: {}, workflow: compensated } });
    repository.claimRunnableNode.mockResolvedValue({
      attempt: 1,
      inputSummary: {},
      nodeKey: 'load',
      runId: RUN_ID,
      workerId: 'w1',
    });
    repository.retryOrFailNode.mockResolvedValue({ status: 'failed' });
    const engine = new ModuleAppWorkflowEngine({
      execute: vi.fn().mockRejectedValue(new Error('permanent')),
      repository,
    });

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(repository.queueNodes).toHaveBeenCalledWith({
      installationId: INSTALLATION_ID,
      nodeInputs: { cleanup: { error: 'permanent' } },
      runId: RUN_ID,
    });
    expect(repository.updateRunStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('cancels installation-bound runs', async () => {
    const repository = createRepository();
    const engine = new ModuleAppWorkflowEngine({ execute: vi.fn(), repository });
    await expect(
      engine.cancel({ installationId: INSTALLATION_ID, runId: RUN_ID }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(repository.cancelRun).toHaveBeenCalledWith({
      installationId: INSTALLATION_ID,
      runId: RUN_ID,
    });
  });

  it('queues the matching condition branch and skips the other branch', async () => {
    const conditional = moduleAppWorkflowDefinitionSchema.parse({
      edges: [
        { from: 'choice', to: 'publish', when: { approved: true } },
        { from: 'choice', to: 'reject', when: { approved: false } },
      ],
      key: 'conditional',
      nodes: [
        { config: {}, key: 'choice', type: 'condition' },
        { config: {}, key: 'publish', type: 'transform' },
        { config: {}, key: 'reject', type: 'transform' },
      ],
      startNodeKey: 'choice',
      version: 1,
    });
    const repository = createRepository();
    repository.getRun.mockResolvedValue({ ...run, context: { input: {}, workflow: conditional } });
    repository.claimRunnableNode.mockResolvedValue({
      attempt: 1,
      inputSummary: {},
      nodeKey: 'choice',
      runId: RUN_ID,
      workerId: 'w1',
    });
    repository.listNodes.mockResolvedValue([
      { nodeKey: 'choice', outputSummary: { approved: true }, status: 'succeeded' },
      { nodeKey: 'publish', status: 'pending' },
      { nodeKey: 'reject', status: 'pending' },
    ]);
    const engine = new ModuleAppWorkflowEngine({
      execute: vi.fn().mockResolvedValue({ output: { approved: true } }),
      repository,
    });

    await engine.executeClaimedNode({ installationId: INSTALLATION_ID, runId: RUN_ID, workerId: 'w1' });
    expect(repository.queueNodes).toHaveBeenCalledWith(
      expect.objectContaining({ nodeInputs: { publish: { approved: true } } }),
    );
    expect(repository.skipNodes).toHaveBeenCalledWith(
      expect.objectContaining({ nodeKeys: ['reject'] }),
    );
  });
});
