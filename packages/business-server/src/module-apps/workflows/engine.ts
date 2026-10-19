import { Buffer } from 'node:buffer';

import {
  type ModuleAppWorkflowDefinition,
  moduleAppWorkflowDefinitionSchema,
  type ModuleAppWorkflowNodeStatus,
  type ModuleAppWorkflowRunStatus,
} from '@lobechat/types';

import type { ModuleAppWorkflowNodeExecutor } from './executors';
import { createModuleAppWorkflowGraph } from './graph';

type WorkflowRun = {
  context: Record<string, unknown>;
  id: string;
  installationId: string;
  status: ModuleAppWorkflowRunStatus;
  workflowDispatchIdle?: boolean;
  workflowRetryAfterMs?: number;
};

type WorkflowNode = {
  attempt?: number;
  inputSummary?: Record<string, unknown>;
  nodeKey: string;
  outputSummary?: Record<string, unknown>;
  runId?: string;
  status?: ModuleAppWorkflowNodeStatus;
  workerId?: null | string;
};

export interface ModuleAppWorkflowRepository {
  cancelRun: (input: { installationId: string; runId: string }) => Promise<WorkflowRun>;
  claimRunnableNode: (input: {
    installationId: string;
    runId: string;
    workerId: string;
  }) => Promise<null | WorkflowNode>;
  completeNode: (input: {
    attempt: number;
    installationId: string;
    nodeKey: string;
    output?: Record<string, unknown>;
    runId: string;
    usage?: Record<string, unknown>;
    workerId: string;
  }) => Promise<unknown>;
  createRun: (input: {
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
  }) => Promise<WorkflowRun>;
  getRun: (input: { installationId: string; runId: string }) => Promise<null | WorkflowRun>;
  listNodes: (input: { installationId: string; runId: string }) => Promise<WorkflowNode[]>;
  markNodeWaiting: (input: {
    attempt: number;
    installationId: string;
    nodeKey: string;
    runId: string;
    workerId: string;
  }) => Promise<unknown>;
  queueNodes: (input: {
    installationId: string;
    nodeInputs: Record<string, Record<string, unknown>>;
    runId: string;
  }) => Promise<unknown>;
  resumeNode: (input: {
    installationId: string;
    nodeKey: string;
    output: Record<string, unknown>;
    runId: string;
  }) => Promise<unknown>;
  retryOrFailNode: (input: {
    attempt: number;
    delayMs: number;
    errorCode: string;
    errorMessage?: string;
    installationId: string;
    nodeKey: string;
    runId: string;
    workerId: string;
  }) => Promise<{ status: ModuleAppWorkflowNodeStatus }>;
  skipNodes: (input: {
    installationId: string;
    nodeKeys: string[];
    runId: string;
  }) => Promise<unknown>;
  updateRunStatus: (input: {
    errorCode?: string;
    installationId: string;
    output?: Record<string, unknown>;
    runId: string;
    status: ModuleAppWorkflowRunStatus;
  }) => Promise<WorkflowRun>;
}

const getWorkflow = (run: WorkflowRun) => {
  const parsed = moduleAppWorkflowDefinitionSchema.safeParse(run.context.workflow);
  if (!parsed.success) throw new Error('MODULE_APP_WORKFLOW_DEFINITION_MISSING');
  return parsed.data;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'MODULE_APP_WORKFLOW_NODE_FAILED';

const assertBoundedSummary = (value: Record<string, unknown>) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024) {
    throw new Error('MODULE_APP_WORKFLOW_SUMMARY_TOO_LARGE');
  }
  return value;
};

const executeWithTimeout = async (
  execute: ModuleAppWorkflowNodeExecutor,
  context: Parameters<ModuleAppWorkflowNodeExecutor>[0],
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execute(context),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('MODULE_APP_WORKFLOW_NODE_TIMEOUT')),
          context.node.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export class ModuleAppWorkflowEngine {
  private readonly execute: ModuleAppWorkflowNodeExecutor;
  private readonly repository: ModuleAppWorkflowRepository;

  constructor(options: {
    execute: ModuleAppWorkflowNodeExecutor;
    repository: ModuleAppWorkflowRepository;
  }) {
    this.execute = options.execute;
    this.repository = options.repository;
  }

  start = async (input: {
    createdBy?: string;
    idempotencyKey: string;
    input?: Record<string, unknown>;
    installationId: string;
    workflow: ModuleAppWorkflowDefinition;
  }) => {
    const workflow = moduleAppWorkflowDefinitionSchema.parse(input.workflow);
    const rootInput = assertBoundedSummary(input.input ?? {});
    return this.repository.createRun({
      context: { input: rootInput, workflow },
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey,
      installationId: input.installationId,
      nodes: workflow.nodes.map((node) => ({
        inputSummary: node.key === workflow.startNodeKey ? rootInput : {},
        key: node.key,
        maxAttempts: node.retry.maxAttempts,
        status: node.key === workflow.startNodeKey ? 'queued' : 'pending',
      })),
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
    });
  };

  private advance = async (run: WorkflowRun, completedNodeKey: string) => {
    const graph = createModuleAppWorkflowGraph(getWorkflow(run));
    const nodes = await this.repository.listNodes({
      installationId: run.installationId,
      runId: run.id,
    });
    const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
    const completed = byKey.get(completedNodeKey);
    const nodeInputs: Record<string, Record<string, unknown>> = {};
    const skippedNodeKeys: string[] = [];
    const effectiveStatus = new Map(nodes.map((node) => [node.nodeKey, node.status]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of graph.definition.nodes) {
        if (effectiveStatus.get(node.key) !== 'pending' || nodeInputs[node.key]) continue;
        const incoming = graph.edgesTo(node.key);
        if (incoming.length === 0) continue;
        const allParentsTerminal = incoming.every((edge) =>
          ['failed', 'skipped', 'succeeded'].includes(effectiveStatus.get(edge.from) ?? ''),
        );
        if (!allParentsTerminal) continue;
        const activeEdges = incoming.filter((edge) => {
          const parent = byKey.get(edge.from);
          return (
            effectiveStatus.get(edge.from) === 'succeeded' &&
            graph.matchesEdge(edge, parent?.outputSummary ?? {})
          );
        });
        const unconditional = incoming.filter((edge) => !edge.when);
        const canQueue =
          unconditional.every((edge) => effectiveStatus.get(edge.from) === 'succeeded') &&
          (unconditional.length > 0 || activeEdges.length > 0);
        if (canQueue) {
          nodeInputs[node.key] = Object.assign(
            {},
            ...activeEdges.map((edge) => byKey.get(edge.from)?.outputSummary ?? {}),
          );
        } else {
          effectiveStatus.set(node.key, 'skipped');
          skippedNodeKeys.push(node.key);
          changed = true;
        }
      }
    }
    if (skippedNodeKeys.length > 0) {
      await this.repository.skipNodes({
        installationId: run.installationId,
        nodeKeys: skippedNodeKeys,
        runId: run.id,
      });
    }
    if (Object.keys(nodeInputs).length > 0) {
      await this.repository.queueNodes({
        installationId: run.installationId,
        nodeInputs,
        runId: run.id,
      });
      return this.repository.updateRunStatus({
        installationId: run.installationId,
        runId: run.id,
        status: 'running',
      });
    }

    if ([...effectiveStatus.values()].every((status) => status === 'succeeded' || status === 'skipped')) {
      return this.repository.updateRunStatus({
        installationId: run.installationId,
        output: completed?.outputSummary ?? {},
        runId: run.id,
        status: 'succeeded',
      });
    }
    if (
      [...effectiveStatus.values()].includes('failed') &&
      ![...effectiveStatus.values()].some((status) =>
        ['queued', 'running', 'waiting'].includes(status ?? ''),
      )
    ) {
      return this.repository.updateRunStatus({
        errorCode: 'MODULE_APP_WORKFLOW_NODE_FAILED',
        installationId: run.installationId,
        runId: run.id,
        status: 'failed',
      });
    }
    return this.repository.updateRunStatus({
      installationId: run.installationId,
      runId: run.id,
      status: 'running',
    });
  };

  executeClaimedNode = async (input: {
    installationId: string;
    runId: string;
    workerId: string;
  }) => {
    const run = await this.repository.getRun(input);
    if (!run) throw new Error('MODULE_APP_WORKFLOW_RUN_NOT_FOUND');
    if (['cancelled', 'failed', 'succeeded'].includes(run.status)) return run;
    const claimed = await this.repository.claimRunnableNode(input);
    if (!claimed) return { ...run, workflowDispatchIdle: true };
    const workflow = getWorkflow(run);
    const node = workflow.nodes.find((item) => item.key === claimed.nodeKey);
    if (!node) throw new Error('MODULE_APP_WORKFLOW_NODE_NOT_FOUND');
    const attempt = claimed.attempt ?? 1;

    if (node.type === 'approval' || node.type === 'wait') {
      await this.repository.markNodeWaiting({
        attempt,
        installationId: input.installationId,
        nodeKey: node.key,
        runId: input.runId,
        workerId: input.workerId,
      });
      return this.repository.updateRunStatus({
        installationId: input.installationId,
        runId: input.runId,
        status: 'waiting',
      });
    }

    try {
      const result = await executeWithTimeout(this.execute, {
        idempotencyKey: `${input.runId}:${node.key}:${attempt}`,
        input: claimed.inputSummary ?? {},
        node,
        runId: input.runId,
      });
      const output = assertBoundedSummary(result.output ?? {});
      const usage = assertBoundedSummary(result.usage ?? {});
      if (result.waiting) {
        await this.repository.markNodeWaiting({
          attempt,
          installationId: input.installationId,
          nodeKey: node.key,
          runId: input.runId,
          workerId: input.workerId,
        });
        return this.repository.updateRunStatus({
          installationId: input.installationId,
          runId: input.runId,
          status: 'waiting',
        });
      }
      await this.repository.completeNode({
        attempt,
        installationId: input.installationId,
        nodeKey: node.key,
        output,
        runId: input.runId,
        usage,
        workerId: input.workerId,
      });
      return this.advance(run, node.key);
    } catch (error) {
      const delayMs = Math.min(
        300_000,
        node.retry.initialDelayMs * node.retry.multiplier ** Math.max(0, attempt - 1),
      );
      const transition = await this.repository.retryOrFailNode({
        attempt,
        delayMs,
        errorCode: 'MODULE_APP_WORKFLOW_NODE_FAILED',
        errorMessage: getErrorMessage(error),
        installationId: input.installationId,
        nodeKey: node.key,
        runId: input.runId,
        workerId: input.workerId,
      });
      if (transition.status === 'failed') {
        if (node.compensationNodeKey) {
          await this.repository.queueNodes({
            installationId: input.installationId,
            nodeInputs: { [node.compensationNodeKey]: { error: getErrorMessage(error) } },
            runId: input.runId,
          });
        } else {
          return this.repository.updateRunStatus({
            errorCode: 'MODULE_APP_WORKFLOW_NODE_FAILED',
            installationId: input.installationId,
            runId: input.runId,
            status: 'failed',
          });
        }
      }
      const currentRun = await this.repository.getRun(input);
      return transition.status === 'queued' && currentRun
        ? { ...currentRun, workflowRetryAfterMs: delayMs }
        : currentRun;
    }
  };

  resume = async (input: {
    installationId: string;
    nodeKey: string;
    runId: string;
    value: Record<string, unknown>;
  }) => {
    const run = await this.repository.getRun(input);
    if (!run) throw new Error('MODULE_APP_WORKFLOW_RUN_NOT_FOUND');
    await this.repository.resumeNode({
      installationId: input.installationId,
      nodeKey: input.nodeKey,
      output: input.value,
      runId: input.runId,
    });
    return this.advance(run, input.nodeKey);
  };

  cancel = (input: { installationId: string; runId: string }) =>
    this.repository.cancelRun(input);

  fail = (input: { errorCode: string; installationId: string; runId: string }) =>
    this.repository.updateRunStatus({ ...input, status: 'failed' });

  drain = async (input: {
    installationId: string;
    maxNodes?: number;
    runId: string;
    workerId: string;
  }) => {
    const maxNodes = Math.min(100, Math.max(1, input.maxNodes ?? 100));
    let run = await this.repository.getRun(input);
    if (!run) throw new Error('MODULE_APP_WORKFLOW_RUN_NOT_FOUND');
    for (let index = 0; index < maxNodes; index++) {
      if (['cancelled', 'failed', 'succeeded', 'waiting'].includes(run.status)) break;
      const next = await this.executeClaimedNode(input);
      if (!next) break;
      run = next;
    }
    return run;
  };
}
