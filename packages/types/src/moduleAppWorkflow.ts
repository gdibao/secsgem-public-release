import { z } from 'zod';

const moduleAppWorkflowKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const moduleAppWorkflowNodeTypeSchema = z.enum([
  'function',
  'http',
  'ai',
  'condition',
  'transform',
  'parallel',
  'wait',
  'approval',
]);
export type ModuleAppWorkflowNodeType = z.infer<typeof moduleAppWorkflowNodeTypeSchema>;

export const moduleAppWorkflowRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
]);
export type ModuleAppWorkflowRunStatus = z.infer<typeof moduleAppWorkflowRunStatusSchema>;

export const moduleAppWorkflowNodeStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
export type ModuleAppWorkflowNodeStatus = z.infer<typeof moduleAppWorkflowNodeStatusSchema>;

export const moduleAppWorkflowNodeSchema = z
  .object({
    compensationNodeKey: moduleAppWorkflowKeySchema.optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    key: moduleAppWorkflowKeySchema,
    retry: z
      .object({
        initialDelayMs: z.number().int().min(100).max(60_000).default(1000),
        maxAttempts: z.number().int().min(1).max(10).default(1),
        multiplier: z.number().min(1).max(10).default(2),
      })
      .strict()
      .default({ initialDelayMs: 1000, maxAttempts: 1, multiplier: 2 }),
    timeoutMs: z.number().int().min(100).max(60_000).default(30_000),
    type: moduleAppWorkflowNodeTypeSchema,
  })
  .strict();
export type ModuleAppWorkflowNode = z.infer<typeof moduleAppWorkflowNodeSchema>;

export const moduleAppWorkflowEdgeSchema = z
  .object({
    from: moduleAppWorkflowKeySchema,
    maxTraversals: z.number().int().min(1).max(100).optional(),
    to: moduleAppWorkflowKeySchema,
    when: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ModuleAppWorkflowEdge = z.infer<typeof moduleAppWorkflowEdgeSchema>;

const findUnboundedCycle = (params: {
  adjacency: Map<string, ModuleAppWorkflowEdge[]>;
  nodeKeys: string[];
}) => {
  const state = new Map<string, 'done' | 'visiting'>();
  const pathNodes: string[] = [];
  const pathEdges: ModuleAppWorkflowEdge[] = [];

  const visit = (nodeKey: string): boolean => {
    state.set(nodeKey, 'visiting');
    pathNodes.push(nodeKey);

    for (const edge of params.adjacency.get(nodeKey) ?? []) {
      if (state.get(edge.to) === 'visiting') {
        const cycleStart = pathNodes.lastIndexOf(edge.to);
        const cycleEdges = [...pathEdges.slice(cycleStart), edge];
        if (cycleEdges.every((cycleEdge) => cycleEdge.maxTraversals === undefined)) return true;
        continue;
      }
      if (state.get(edge.to) === 'done') continue;
      pathEdges.push(edge);
      if (visit(edge.to)) return true;
      pathEdges.pop();
    }

    pathNodes.pop();
    state.set(nodeKey, 'done');
    return false;
  };

  return params.nodeKeys.some((nodeKey) => !state.has(nodeKey) && visit(nodeKey));
};

export const moduleAppWorkflowDefinitionSchema = z
  .object({
    edges: z.array(moduleAppWorkflowEdgeSchema).max(300),
    key: moduleAppWorkflowKeySchema,
    nodes: z.array(moduleAppWorkflowNodeSchema).min(1).max(100),
    startNodeKey: moduleAppWorkflowKeySchema,
    version: z.number().int().min(1).max(1_000_000),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const nodeKeys = new Set<string>();
    workflow.nodes.forEach((node, index) => {
      if (nodeKeys.has(node.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_node_duplicate',
          path: ['nodes', index, 'key'],
        });
      }
      nodeKeys.add(node.key);
    });
    if (!nodeKeys.has(workflow.startNodeKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_workflow_start_missing',
        path: ['startNodeKey'],
      });
    }

    const adjacency = new Map<string, ModuleAppWorkflowEdge[]>();
    const edgeKeys = new Set<string>();
    workflow.edges.forEach((edge, index) => {
      if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_edge_node_missing',
          path: ['edges', index],
        });
        return;
      }
      const edgeKey = `${edge.from}:${edge.to}`;
      if (edgeKeys.has(edgeKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_edge_duplicate',
          path: ['edges', index],
        });
      }
      edgeKeys.add(edgeKey);
      const outgoing = adjacency.get(edge.from) ?? [];
      outgoing.push(edge);
      adjacency.set(edge.from, outgoing);
    });

    for (const [nodeKey, outgoing] of adjacency) {
      if (outgoing.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_fanout_exceeded',
          path: ['nodes', workflow.nodes.findIndex((node) => node.key === nodeKey)],
        });
      }
    }

    const reachable = new Set<string>();
    const queue = nodeKeys.has(workflow.startNodeKey) ? [workflow.startNodeKey] : [];
    while (queue.length > 0) {
      const nodeKey = queue.shift()!;
      if (reachable.has(nodeKey)) continue;
      reachable.add(nodeKey);
      for (const edge of adjacency.get(nodeKey) ?? []) queue.push(edge.to);
    }
    workflow.nodes.forEach((node, index) => {
      if (!reachable.has(node.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_node_unreachable',
          path: ['nodes', index],
        });
      }
      if (node.compensationNodeKey && !nodeKeys.has(node.compensationNodeKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_workflow_compensation_missing',
          path: ['nodes', index, 'compensationNodeKey'],
        });
      }
    });

    if (findUnboundedCycle({ adjacency, nodeKeys: [...nodeKeys] })) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_workflow_cycle_unbounded' });
    }
  });
export type ModuleAppWorkflowDefinition = z.infer<typeof moduleAppWorkflowDefinitionSchema>;

export const moduleAppTaskRunInputSchema = z.object({ runId: z.string().uuid() }).strict();
export type ModuleAppTaskRunInput = z.infer<typeof moduleAppTaskRunInputSchema>;

export type ModuleAppTaskRun = {
  id: string;
  status: ModuleAppWorkflowRunStatus;
  [key: string]: unknown;
};
