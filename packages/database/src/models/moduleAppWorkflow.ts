import type { ModuleAppWorkflowRunStatus } from '@lobechat/types';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { moduleAppWorkflowNodes, moduleAppWorkflowRuns } from '../schemas';
import type { LobeChatDatabase } from '../type';

type ModuleAppWorkflowModelOptions = {
  leaseMs?: number;
  now?: () => Date;
};

export class ModuleAppWorkflowModel {
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: LobeChatDatabase,
    options: ModuleAppWorkflowModelOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    if (this.leaseMs < 100 || this.leaseMs > 300_000) {
      throw new Error('MODULE_APP_WORKFLOW_LEASE_INVALID');
    }
    this.now = options.now ?? (() => new Date());
  }

  createRun = async (input: {
    context?: Record<string, unknown>;
    createdBy?: string;
    idempotencyKey: string;
    installationId: string;
    nodes: Array<{
      inputSummary?: Record<string, unknown>;
      key: string;
      maxAttempts?: number;
      status?: 'pending' | 'queued';
    }>;
    workflowKey: string;
    workflowVersion: number;
  }) => {
    if (input.nodes.length < 1 || input.nodes.length > 100) {
      throw new Error('MODULE_APP_WORKFLOW_NODES_INVALID');
    }

    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(moduleAppWorkflowRuns)
        .values({
          context: input.context,
          createdBy: input.createdBy,
          idempotencyKey: input.idempotencyKey,
          installationId: input.installationId,
          workflowKey: input.workflowKey,
          workflowVersion: input.workflowVersion,
        })
        .onConflictDoNothing({
          target: [
            moduleAppWorkflowRuns.installationId,
            moduleAppWorkflowRuns.workflowKey,
            moduleAppWorkflowRuns.idempotencyKey,
          ],
        })
        .returning();
      if (!run) {
        const existing = await tx.query.moduleAppWorkflowRuns.findFirst({
          where: and(
            eq(moduleAppWorkflowRuns.installationId, input.installationId),
            eq(moduleAppWorkflowRuns.workflowKey, input.workflowKey),
            eq(moduleAppWorkflowRuns.idempotencyKey, input.idempotencyKey),
          ),
        });
        if (!existing) throw new Error('MODULE_APP_WORKFLOW_RUN_CREATE_FAILED');
        return existing;
      }

      await tx.insert(moduleAppWorkflowNodes).values(
        input.nodes.map((node) => ({
          inputSummary: node.inputSummary,
          installationId: input.installationId,
          maxAttempts: node.maxAttempts ?? 1,
          nodeKey: node.key,
          runId: run.id,
          status: node.status ?? 'queued',
          availableAt: this.now(),
        })),
      );
      return run;
    });
  };

  getRun = async (input: { installationId: string; runId: string }) => {
    const run = await this.db.query.moduleAppWorkflowRuns.findFirst({
      where: and(
        eq(moduleAppWorkflowRuns.id, input.runId),
        eq(moduleAppWorkflowRuns.installationId, input.installationId),
      ),
    });
    return run ?? null;
  };

  listNodes = (input: { installationId: string; runId: string }) =>
    this.db.query.moduleAppWorkflowNodes.findMany({
      orderBy: [asc(moduleAppWorkflowNodes.createdAt)],
      where: and(
        eq(moduleAppWorkflowNodes.installationId, input.installationId),
        eq(moduleAppWorkflowNodes.runId, input.runId),
      ),
    });

  claimRunnableNode = async ({
    installationId,
    runId,
    workerId,
  }: {
    installationId?: string;
    runId?: string;
    workerId: string;
  }) => {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);

    return this.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: moduleAppWorkflowNodes.id, runId: moduleAppWorkflowNodes.runId })
        .from(moduleAppWorkflowNodes)
        .innerJoin(moduleAppWorkflowRuns, eq(moduleAppWorkflowRuns.id, moduleAppWorkflowNodes.runId))
        .where(
          and(
            inArray(moduleAppWorkflowRuns.status, ['queued', 'running', 'waiting']),
            installationId
              ? eq(moduleAppWorkflowNodes.installationId, installationId)
              : undefined,
            runId ? eq(moduleAppWorkflowNodes.runId, runId) : undefined,
            lte(moduleAppWorkflowNodes.availableAt, now),
            lt(moduleAppWorkflowNodes.attempt, moduleAppWorkflowNodes.maxAttempts),
            or(
              eq(moduleAppWorkflowNodes.status, 'queued'),
              and(
                eq(moduleAppWorkflowNodes.status, 'running'),
                lte(moduleAppWorkflowNodes.leaseExpiresAt, now),
              ),
            ),
          ),
        )
        .orderBy(asc(moduleAppWorkflowNodes.availableAt), asc(moduleAppWorkflowNodes.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;

      const [claimed] = await tx
        .update(moduleAppWorkflowNodes)
        .set({
          attempt: sql`${moduleAppWorkflowNodes.attempt} + 1`,
          leaseExpiresAt,
          startedAt: now,
          status: 'running',
          updatedAt: now,
          workerId,
        })
        .where(eq(moduleAppWorkflowNodes.id, candidate.id))
        .returning();
      if (!claimed) return null;

      await tx
        .update(moduleAppWorkflowRuns)
        .set({
          startedAt: sql`COALESCE(${moduleAppWorkflowRuns.startedAt}, ${now})`,
          status: 'running',
          updatedAt: now,
        })
        .where(
          and(
            eq(moduleAppWorkflowRuns.id, candidate.runId),
            inArray(moduleAppWorkflowRuns.status, ['queued', 'waiting']),
          ),
        );
      return claimed;
    });
  };

  completeNode = async (input: {
    attempt: number;
    installationId: string;
    nodeKey: string;
    output?: Record<string, unknown>;
    runId: string;
    usage?: Record<string, unknown>;
    workerId: string;
  }) => {
    const now = this.now();
    const [node] = await this.db
      .update(moduleAppWorkflowNodes)
      .set({
        completedAt: now,
        leaseExpiresAt: null,
        outputSummary: input.output ?? {},
        status: 'succeeded',
        updatedAt: now,
        usage: input.usage ?? {},
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppWorkflowNodes.installationId, input.installationId),
          eq(moduleAppWorkflowNodes.runId, input.runId),
          eq(moduleAppWorkflowNodes.nodeKey, input.nodeKey),
          eq(moduleAppWorkflowNodes.status, 'running'),
          eq(moduleAppWorkflowNodes.workerId, input.workerId),
          eq(moduleAppWorkflowNodes.attempt, input.attempt),
        ),
      )
      .returning();
    if (!node) throw new Error('MODULE_APP_WORKFLOW_NODE_STALE_CLAIM');
    return node;
  };

  markNodeWaiting = async (input: {
    attempt: number;
    installationId: string;
    nodeKey: string;
    runId: string;
    workerId: string;
  }) => {
    const now = this.now();
    const [node] = await this.db
      .update(moduleAppWorkflowNodes)
      .set({ leaseExpiresAt: null, status: 'waiting', updatedAt: now, workerId: null })
      .where(
        and(
          eq(moduleAppWorkflowNodes.installationId, input.installationId),
          eq(moduleAppWorkflowNodes.runId, input.runId),
          eq(moduleAppWorkflowNodes.nodeKey, input.nodeKey),
          eq(moduleAppWorkflowNodes.status, 'running'),
          eq(moduleAppWorkflowNodes.workerId, input.workerId),
          eq(moduleAppWorkflowNodes.attempt, input.attempt),
        ),
      )
      .returning();
    if (!node) throw new Error('MODULE_APP_WORKFLOW_NODE_STALE_CLAIM');
    await this.updateRunStatus({
      installationId: input.installationId,
      runId: input.runId,
      status: 'waiting',
    });
    return node;
  };

  retryOrFailNode = async (input: {
    attempt: number;
    delayMs: number;
    errorCode: string;
    errorMessage?: string;
    installationId: string;
    nodeKey: string;
    runId: string;
    workerId: string;
  }) => {
    const now = this.now();
    const current = await this.db.query.moduleAppWorkflowNodes.findFirst({
      where: and(
        eq(moduleAppWorkflowNodes.installationId, input.installationId),
        eq(moduleAppWorkflowNodes.runId, input.runId),
        eq(moduleAppWorkflowNodes.nodeKey, input.nodeKey),
        eq(moduleAppWorkflowNodes.status, 'running'),
        eq(moduleAppWorkflowNodes.workerId, input.workerId),
        eq(moduleAppWorkflowNodes.attempt, input.attempt),
      ),
    });
    if (!current) throw new Error('MODULE_APP_WORKFLOW_NODE_STALE_CLAIM');
    const exhausted = current.attempt >= current.maxAttempts;
    const [node] = await this.db
      .update(moduleAppWorkflowNodes)
      .set({
        availableAt: exhausted ? current.availableAt : new Date(now.getTime() + input.delayMs),
        completedAt: exhausted ? now : null,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        leaseExpiresAt: null,
        status: exhausted ? 'failed' : 'queued',
        updatedAt: now,
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppWorkflowNodes.id, current.id),
          eq(moduleAppWorkflowNodes.status, 'running'),
          eq(moduleAppWorkflowNodes.workerId, input.workerId),
          eq(moduleAppWorkflowNodes.attempt, input.attempt),
        ),
      )
      .returning();
    if (!node) throw new Error('MODULE_APP_WORKFLOW_NODE_TRANSITION_FAILED');
    return node;
  };

  queueNodes = async (input: {
    installationId: string;
    nodeInputs: Record<string, Record<string, unknown>>;
    runId: string;
  }) => {
    const nodes = [];
    for (const [nodeKey, inputSummary] of Object.entries(input.nodeInputs)) {
      const [node] = await this.db
        .update(moduleAppWorkflowNodes)
        .set({ availableAt: this.now(), inputSummary, status: 'queued', updatedAt: this.now() })
        .where(
          and(
            eq(moduleAppWorkflowNodes.installationId, input.installationId),
            eq(moduleAppWorkflowNodes.runId, input.runId),
            eq(moduleAppWorkflowNodes.nodeKey, nodeKey),
            eq(moduleAppWorkflowNodes.status, 'pending'),
          ),
        )
        .returning();
      if (node) nodes.push(node);
    }
    return nodes;
  };

  skipNodes = async (input: { installationId: string; nodeKeys: string[]; runId: string }) => {
    if (input.nodeKeys.length === 0) return [];
    return this.db
      .update(moduleAppWorkflowNodes)
      .set({ completedAt: this.now(), status: 'skipped', updatedAt: this.now() })
      .where(
        and(
          eq(moduleAppWorkflowNodes.installationId, input.installationId),
          eq(moduleAppWorkflowNodes.runId, input.runId),
          inArray(moduleAppWorkflowNodes.nodeKey, input.nodeKeys),
          eq(moduleAppWorkflowNodes.status, 'pending'),
        ),
      )
      .returning();
  };

  resumeNode = async (input: {
    installationId: string;
    nodeKey: string;
    output: Record<string, unknown>;
    runId: string;
  }) => {
    const now = this.now();
    const [node] = await this.db
      .update(moduleAppWorkflowNodes)
      .set({ completedAt: now, outputSummary: input.output, status: 'succeeded', updatedAt: now })
      .where(
        and(
          eq(moduleAppWorkflowNodes.installationId, input.installationId),
          eq(moduleAppWorkflowNodes.runId, input.runId),
          eq(moduleAppWorkflowNodes.nodeKey, input.nodeKey),
          eq(moduleAppWorkflowNodes.status, 'waiting'),
        ),
      )
      .returning();
    if (!node) throw new Error('MODULE_APP_WORKFLOW_NODE_NOT_WAITING');
    await this.updateRunStatus({
      installationId: input.installationId,
      runId: input.runId,
      status: 'running',
    });
    return node;
  };

  updateRunStatus = async (input: {
    errorCode?: string;
    installationId: string;
    output?: Record<string, unknown>;
    runId: string;
    status: ModuleAppWorkflowRunStatus;
  }) => {
    const now = this.now();
    const terminal = ['cancelled', 'failed', 'succeeded'].includes(input.status);
    const [run] = await this.db
      .update(moduleAppWorkflowRuns)
      .set({
        completedAt: terminal ? now : null,
        errorCode: input.errorCode,
        outputSummary: input.output,
        status: input.status,
        updatedAt: now,
      })
      .where(
        and(
          eq(moduleAppWorkflowRuns.installationId, input.installationId),
          eq(moduleAppWorkflowRuns.id, input.runId),
          inArray(moduleAppWorkflowRuns.status, ['queued', 'running', 'waiting']),
        ),
      )
      .returning();
    if (!run) throw new Error('MODULE_APP_WORKFLOW_RUN_NOT_FOUND');
    return run;
  };

  cancelRun = async (input: { installationId: string; runId: string }) =>
    this.db.transaction(async (tx) => {
      const now = this.now();
      const [run] = await tx
        .update(moduleAppWorkflowRuns)
        .set({ completedAt: now, status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(moduleAppWorkflowRuns.installationId, input.installationId),
            eq(moduleAppWorkflowRuns.id, input.runId),
            inArray(moduleAppWorkflowRuns.status, ['queued', 'running', 'waiting']),
          ),
        )
        .returning();
      if (!run) throw new Error('MODULE_APP_WORKFLOW_RUN_NOT_CANCELLABLE');
      await tx
        .update(moduleAppWorkflowNodes)
        .set({ completedAt: now, leaseExpiresAt: null, status: 'cancelled', updatedAt: now, workerId: null })
        .where(
          and(
            eq(moduleAppWorkflowNodes.installationId, input.installationId),
            eq(moduleAppWorkflowNodes.runId, input.runId),
            inArray(moduleAppWorkflowNodes.status, ['pending', 'queued', 'running', 'waiting']),
          ),
        );
      return run;
    });
}
