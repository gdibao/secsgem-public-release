import type { ModuleAppWorkflowNode } from '@lobechat/types';

const MODULE_APP_WORKFLOW_OUTPUT_MAX_BYTES = 256 * 1024;

export type ModuleAppWorkflowExecutionContext = {
  idempotencyKey: string;
  input: Record<string, unknown>;
  node: ModuleAppWorkflowNode;
  runId: string;
};

export type ModuleAppWorkflowExecutionResult = {
  output?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  waiting?: boolean;
};

export type ModuleAppWorkflowNodeExecutor = (
  context: ModuleAppWorkflowExecutionContext,
) => Promise<ModuleAppWorkflowExecutionResult>;

export const assertModuleAppWorkflowOutput = (output: Record<string, unknown>) => {
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MODULE_APP_WORKFLOW_OUTPUT_MAX_BYTES) {
    throw new Error('MODULE_APP_WORKFLOW_OUTPUT_TOO_LARGE');
  }

  return output;
};

export const createModuleAppWorkflowExecutor = (options: {
  ai?: ModuleAppWorkflowNodeExecutor;
  function?: ModuleAppWorkflowNodeExecutor;
  http?: ModuleAppWorkflowNodeExecutor;
  transform?: ModuleAppWorkflowNodeExecutor;
}): ModuleAppWorkflowNodeExecutor => async (context) => {
  switch (context.node.type) {
    case 'approval':
    case 'wait': {
      return { waiting: true };
    }
    case 'ai':
    case 'function':
    case 'http': {
      const executor = options[context.node.type];
      if (!executor) throw new Error(`MODULE_APP_WORKFLOW_EXECUTOR_REQUIRED:${context.node.type}`);
      return executor(context);
    }
    case 'condition':
    case 'parallel': {
      return { output: context.input };
    }
    case 'transform': {
      if (options.transform) return options.transform(context);
      const output = context.node.config.output;
      return {
        output: output && typeof output === 'object' && !Array.isArray(output)
          ? (output as Record<string, unknown>)
          : context.input,
      };
    }
  }
};
