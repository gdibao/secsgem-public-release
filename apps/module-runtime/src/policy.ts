import {
  type ModuleAppInvocation,
  moduleAppInvocationSchema,
} from '@lobechat/types';

const MODULE_APP_RUNTIME_MAX_INPUT_BYTES = 1024 * 1024;

export const assertModuleAppRuntimePolicy = (input: unknown): ModuleAppInvocation => {
  const parsed = moduleAppInvocationSchema.safeParse(input);
  if (!parsed.success) throw new Error('MODULE_APP_RUNTIME_POLICY_DENIED');

  if (parsed.data.capability.length > 8192) {
    throw new Error('MODULE_APP_RUNTIME_POLICY_DENIED');
  }
  let inputBytes: number;
  try {
    inputBytes = Buffer.byteLength(JSON.stringify(parsed.data.input));
  } catch {
    throw new Error('MODULE_APP_RUNTIME_POLICY_DENIED');
  }
  if (inputBytes > MODULE_APP_RUNTIME_MAX_INPUT_BYTES) {
    throw new Error('MODULE_APP_RUNTIME_POLICY_DENIED');
  }

  return parsed.data;
};
