import {
  type ModuleAppWorkflowDefinition,
  moduleAppWorkflowDefinitionSchema,
  type ModuleAppWorkflowEdge,
} from '@lobechat/types';

const matchesCondition = (condition: Record<string, unknown> | undefined, output: Record<string, unknown>) =>
  !condition || Object.entries(condition).every(([key, value]) => Object.is(output[key], value));

export const createModuleAppWorkflowGraph = (definition: ModuleAppWorkflowDefinition) => {
  const workflow = moduleAppWorkflowDefinitionSchema.parse(definition);
  const nodes = new Map(workflow.nodes.map((node) => [node.key, node]));
  const incoming = new Map<string, ModuleAppWorkflowEdge[]>();
  const outgoing = new Map<string, ModuleAppWorkflowEdge[]>();
  for (const edge of workflow.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  return {
    definition: workflow,
    edgesFrom: (nodeKey: string) => outgoing.get(nodeKey) ?? [],
    edgesTo: (nodeKey: string) => incoming.get(nodeKey) ?? [],
    matchesEdge: (edge: ModuleAppWorkflowEdge, output: Record<string, unknown>) =>
      matchesCondition(edge.when, output),
    nextEdges: (nodeKey: string, output: Record<string, unknown> = {}) =>
      (outgoing.get(nodeKey) ?? []).filter((edge) => matchesCondition(edge.when, output)),
    node: (nodeKey: string) => nodes.get(nodeKey),
    parentsOf: (nodeKey: string) =>
      (incoming.get(nodeKey) ?? [])
        .map((edge) => nodes.get(edge.from))
        .filter((node) => node !== undefined),
  };
};
