import { describe, expect, it } from 'vitest';

import { moduleAppWorkflowDefinitionSchema } from './moduleAppWorkflow';

const workflow = {
  edges: [
    { from: 'load', to: 'review' },
    { from: 'review', to: 'finish' },
  ],
  key: 'candidate_review',
  nodes: [
    { config: { functionKey: 'load_candidate' }, key: 'load', type: 'function' },
    { config: {}, key: 'review', type: 'approval' },
    { config: {}, key: 'finish', type: 'transform' },
  ],
  startNodeKey: 'load',
  version: 1,
};

describe('module app workflow contracts', () => {
  it('accepts a bounded reachable workflow graph', () => {
    expect(moduleAppWorkflowDefinitionSchema.parse(workflow)).toMatchObject({
      key: 'candidate_review',
      startNodeKey: 'load',
      version: 1,
    });
  });

  it('rejects unknown node types and duplicate node keys', () => {
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        nodes: [{ config: {}, key: 'load', type: 'unknown' }],
      }),
    ).toThrow();
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        nodes: [workflow.nodes[0], workflow.nodes[0]],
      }),
    ).toThrow();
  });

  it('rejects missing edge targets and unreachable nodes', () => {
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        edges: [{ from: 'load', to: 'missing' }],
      }),
    ).toThrow();
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        edges: [{ from: 'load', to: 'review' }],
      }),
    ).toThrow();
  });

  it('rejects unbounded cycles and excessive fan-out', () => {
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        edges: [...workflow.edges, { from: 'finish', to: 'load' }],
      }),
    ).toThrow();

    const branchNodes = Array.from({ length: 11 }, (_, index) => ({
      config: {},
      key: `branch_${index}`,
      type: 'transform',
    }));
    expect(() =>
      moduleAppWorkflowDefinitionSchema.parse({
        ...workflow,
        edges: branchNodes.map((node) => ({ from: 'load', to: node.key })),
        nodes: [workflow.nodes[0], ...branchNodes],
      }),
    ).toThrow();
  });
});
