// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppInstallations,
  moduleApps,
  moduleAppVersions,
  moduleAppWorkflowNodes,
  moduleAppWorkflowRuns,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppWorkflowModel } from '../moduleAppWorkflow';

const USER_ID = 'module-app-workflow-user';
let now = new Date('2026-07-11T02:00:00.000Z');
const serverDB: LobeChatDatabase = await getTestDB();

const createInstallation = async () => {
  const [app] = await serverDB
    .insert(moduleApps)
    .values({
      appType: 'workflow_app',
      category: 'business',
      description: 'Workflow test.',
      displayName: 'Workflow',
      icon: 'Workflow',
      slug: `workflow-${crypto.randomUUID()}`,
    })
    .returning();
  const [version] = await serverDB
    .insert(moduleAppVersions)
    .values({ appId: app.id, version: '1.0.0' })
    .returning();
  const [installation] = await serverDB
    .insert(moduleAppInstallations)
    .values({ appId: app.id, scopeType: 'personal', userId: USER_ID, versionId: version.id })
    .returning();
  return installation;
};

beforeEach(async () => {
  now = new Date('2026-07-11T02:00:00.000Z');
  await serverDB.delete(moduleAppWorkflowNodes);
  await serverDB.delete(moduleAppWorkflowRuns);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
});

describe('ModuleAppWorkflowModel', () => {
  it('claims one runnable node and keeps runs installation-bound', async () => {
    const installationA = await createInstallation();
    const installationB = await createInstallation();
    const model = new ModuleAppWorkflowModel(serverDB, { now: () => now });
    const run = await model.createRun({
      idempotencyKey: 'request-1',
      installationId: installationA.id,
      nodes: [{ key: 'load', maxAttempts: 2 }],
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });

    await expect(model.claimRunnableNode({ workerId: 'worker-a' })).resolves.toMatchObject({
      attempt: 1,
      nodeKey: 'load',
      runId: run.id,
      status: 'running',
      workerId: 'worker-a',
    });
    await expect(model.claimRunnableNode({ workerId: 'worker-b' })).resolves.toBeNull();
    await expect(
      model.getRun({ installationId: installationB.id, runId: run.id }),
    ).resolves.toBeNull();
    await expect(
      serverDB.insert(moduleAppWorkflowNodes).values({
        installationId: installationB.id,
        nodeKey: 'cross-installation',
        runId: run.id,
      }),
    ).rejects.toThrow();
  });

  it('reclaims an expired lease without exceeding the retry limit', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppWorkflowModel(serverDB, { leaseMs: 1000, now: () => now });
    await model.createRun({
      idempotencyKey: 'request-2',
      installationId: installation.id,
      nodes: [{ key: 'load', maxAttempts: 2 }],
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });

    await expect(model.claimRunnableNode({ workerId: 'worker-a' })).resolves.toMatchObject({ attempt: 1 });
    now = new Date(now.getTime() + 1001);
    await expect(model.claimRunnableNode({ workerId: 'worker-b' })).resolves.toMatchObject({ attempt: 2 });
    now = new Date(now.getTime() + 1001);
    await expect(model.claimRunnableNode({ workerId: 'worker-c' })).resolves.toBeNull();
  });

  it('persists waiting, resume, retry, success, and cancellation transitions', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppWorkflowModel(serverDB, { now: () => now });
    const run = await model.createRun({
      idempotencyKey: 'request-transitions',
      installationId: installation.id,
      nodes: [
        { key: 'load', maxAttempts: 2 },
        { key: 'approval', status: 'pending' },
      ],
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });
    const load = await model.claimRunnableNode({
      installationId: installation.id,
      runId: run.id,
      workerId: 'worker-a',
    });
    await expect(
      model.retryOrFailNode({
        attempt: load!.attempt,
        delayMs: 1000,
        errorCode: 'temporary',
        installationId: installation.id,
        nodeKey: 'load',
        runId: run.id,
        workerId: 'worker-a',
      }),
    ).resolves.toMatchObject({ status: 'queued' });
    now = new Date(now.getTime() + 1001);
    const retried = await model.claimRunnableNode({
      installationId: installation.id,
      runId: run.id,
      workerId: 'worker-b',
    });
    await model.completeNode({
      attempt: retried!.attempt,
      installationId: installation.id,
      nodeKey: 'load',
      output: { candidate: 'A' },
      runId: run.id,
      workerId: 'worker-b',
    });
    await model.queueNodes({
      installationId: installation.id,
      nodeInputs: { approval: { candidate: 'A' } },
      runId: run.id,
    });
    const approval = await model.claimRunnableNode({
      installationId: installation.id,
      runId: run.id,
      workerId: 'worker-c',
    });
    await model.markNodeWaiting({
      attempt: approval!.attempt,
      installationId: installation.id,
      nodeKey: 'approval',
      runId: run.id,
      workerId: 'worker-c',
    });
    await expect(
      model.resumeNode({
        installationId: installation.id,
        nodeKey: 'approval',
        output: { approved: true },
        runId: run.id,
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    await model.updateRunStatus({
      installationId: installation.id,
      output: { approved: true },
      runId: run.id,
      status: 'succeeded',
    });
    await expect(
      model.getRun({ installationId: installation.id, runId: run.id }),
    ).resolves.toMatchObject({ status: 'succeeded' });

    const cancelRun = await model.createRun({
      idempotencyKey: 'request-cancel',
      installationId: installation.id,
      nodes: [{ key: 'load' }],
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });
    await expect(
      model.cancelRun({ installationId: installation.id, runId: cancelRun.id }),
    ).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('deduplicates starts and makes exhausted or completed claims terminal', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppWorkflowModel(serverDB, { now: () => now });
    const input = {
      idempotencyKey: 'request-deduplicated',
      installationId: installation.id,
      nodes: [{ key: 'load', maxAttempts: 1 }],
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    };
    const first = await model.createRun(input);
    const duplicate = await model.createRun(input);
    expect(duplicate.id).toBe(first.id);
    await expect(
      model.listNodes({ installationId: installation.id, runId: first.id }),
    ).resolves.toHaveLength(1);

    const claim = await model.claimRunnableNode({
      installationId: installation.id,
      runId: first.id,
      workerId: 'worker-a',
    });
    await expect(
      model.retryOrFailNode({
        attempt: claim!.attempt,
        delayMs: 1000,
        errorCode: 'permanent',
        installationId: installation.id,
        nodeKey: 'load',
        runId: first.id,
        workerId: 'worker-a',
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      model.claimRunnableNode({
        installationId: installation.id,
        runId: first.id,
        workerId: 'worker-b',
      }),
    ).resolves.toBeNull();

    const completedRun = await model.createRun({
      ...input,
      idempotencyKey: 'request-completed-output',
    });
    const completedClaim = await model.claimRunnableNode({
      installationId: installation.id,
      runId: completedRun.id,
      workerId: 'worker-output',
    });
    const completion = {
      attempt: completedClaim!.attempt,
      installationId: installation.id,
      nodeKey: 'load',
      output: { persisted: true },
      runId: completedRun.id,
      workerId: 'worker-output',
    };
    await expect(model.completeNode(completion)).resolves.toMatchObject({
      outputSummary: { persisted: true },
      status: 'succeeded',
    });
    await expect(model.completeNode(completion)).rejects.toThrow(
      'MODULE_APP_WORKFLOW_NODE_STALE_CLAIM',
    );
    await expect(
      model.claimRunnableNode({
        installationId: installation.id,
        runId: completedRun.id,
        workerId: 'worker-after-output',
      }),
    ).resolves.toBeNull();
  });

  it('continues queued parallel work while another node is waiting', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppWorkflowModel(serverDB, { now: () => now });
    const run = await model.createRun({
      idempotencyKey: 'request-parallel-wait',
      installationId: installation.id,
      nodes: [{ key: 'approval' }, { key: 'parallel_work' }],
      workflowKey: 'parallel_review',
      workflowVersion: 1,
    });
    const approval = await model.claimRunnableNode({
      installationId: installation.id,
      runId: run.id,
      workerId: 'worker-a',
    });
    await model.markNodeWaiting({
      attempt: approval!.attempt,
      installationId: installation.id,
      nodeKey: approval!.nodeKey,
      runId: run.id,
      workerId: 'worker-a',
    });
    await expect(
      model.claimRunnableNode({
        installationId: installation.id,
        runId: run.id,
        workerId: 'worker-b',
      }),
    ).resolves.toMatchObject({ nodeKey: 'parallel_work', status: 'running' });
  });
});
