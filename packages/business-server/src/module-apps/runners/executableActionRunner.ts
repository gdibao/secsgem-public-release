import type { ModuleAppActionConfig } from '@lobechat/types';

type RuntimeResponse = {
  output?: Record<string, unknown>;
  stderr?: string;
  stdout?: string;
};

export type ModuleAppExecutableActionInvoker = (input: {
  action: ModuleAppActionConfig;
  artifactSha256: string;
  input: Record<string, unknown>;
  invocationId: string;
}) => Promise<RuntimeResponse>;

const parseOutput = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MODULE_APP_RUNTIME_OUTPUT_INVALID');
  }

  return value as Record<string, unknown>;
};

export const runModuleAppExecutableAction = async (params: {
  action: ModuleAppActionConfig;
  artifactSha256: string;
  input: Record<string, unknown>;
  invoke: ModuleAppExecutableActionInvoker;
  invocationId: string;
}) => {
  const result = await params.invoke({
    action: params.action,
    artifactSha256: params.artifactSha256,
    input: params.input,
    invocationId: params.invocationId,
  });

  return {
    output: parseOutput(result.output),
    preview: '',
  };
};
