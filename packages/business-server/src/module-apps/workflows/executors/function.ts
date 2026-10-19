import {
  assertModuleAppWorkflowOutput,
  type ModuleAppWorkflowExecutionContext,
  type ModuleAppWorkflowNodeExecutor,
} from '../executors';

export type ModuleAppWorkflowFunction = (
  context: ModuleAppWorkflowExecutionContext,
) => Promise<Record<string, unknown>>;

export type ModuleAppWorkflowFunctionRegistry = Readonly<
  Record<string, ModuleAppWorkflowFunction>
>;

export const createModuleAppFunctionWorkflowExecutor = (options: {
  assertEntitlement: () => Promise<unknown> | unknown;
  registry: ModuleAppWorkflowFunctionRegistry;
}): ModuleAppWorkflowNodeExecutor => async (context) => {
  const functionKey = context.node.config.functionKey;
  if (typeof functionKey !== 'string' || !functionKey.trim()) {
    throw new Error('MODULE_APP_WORKFLOW_FUNCTION_NOT_CONFIGURED');
  }
  const execute = options.registry[functionKey];
  if (!execute) throw new Error('MODULE_APP_WORKFLOW_FUNCTION_NOT_REGISTERED');

  await options.assertEntitlement();
  return { output: assertModuleAppWorkflowOutput(await execute(context)) };
};
