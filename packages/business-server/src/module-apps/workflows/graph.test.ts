import type { ModuleAppWorkflowDefinition } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createModuleAppWorkflowGraph } from './graph';

const workflow: ModuleAppWorkflowDefinition = {
  edges: [
    { from: 'load', to: 'approved' },
    { from: 'approved', to: 'publish', when: { approved: true } },
    { from: 'approved', to: 'reject', when: { approved: false } },
  ],
  key: 'candidate_review',
  nodes: [
    { config: {}, key: 'load', retry: { initialDelayMs: 100, maxAttempts: 1, multiplier: 2 }, timeoutMs: 1000, type: 'function' },
    { config: {}, key: 'approved', retry: { initialDelayMs: 100, maxAttempts: 1, multiplier: 2 }, timeoutMs: 1000, type: 'approval' },
    { config: {}, key: 'publish', retry: { initialDelayMs: 100, maxAttempts: 1, multiplier: 2 }, timeoutMs: 1000, type: 'transform' },
    { config: {}, key: 'reject', retry: { initialDelayMs: 100, maxAttempts: 1, multiplier: 2 }, timeoutMs: 1000, type: 'transform' },
  ],
  startNodeKey: 'load',
  version: 1,
};

describe('module app workflow graph', () => {
  it('indexes parents and selects conditional branches deterministically', () => {
    const graph = createModuleAppWorkflowGraph(workflow);
    expect(graph.parentsOf('publish').map((node) => node.key)).toEqual(['approved']);
    expect(graph.nextEdges('approved', { approved: true }).map((edge) => edge.to)).toEqual([
      'publish',
    ]);
    expect(graph.nextEdges('approved', { approved: false }).map((edge) => edge.to)).toEqual([
      'reject',
    ]);
  });
});
