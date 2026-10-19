import {
  getModuleAppDeclaredSecretKeys,
  getModuleAppGeneralOutboundHosts,
  type ModuleAppActionConfig,
  type ModuleAppWorkflowDefinition,
  moduleAppWorkflowDefinitionSchema,
} from '@lobechat/types';

const getRuntime = (runtimeManifest: unknown) => {
  if (!runtimeManifest || typeof runtimeManifest !== 'object' || !('runtime' in runtimeManifest)) {
    return null;
  }
  const runtime = runtimeManifest.runtime;
  return runtime && typeof runtime === 'object' ? (runtime as Record<string, unknown>) : null;
};

export const resolveModuleAppActionOutboundHosts = (input: { runtimeManifest: unknown }) => {
  return getModuleAppGeneralOutboundHosts(input.runtimeManifest);
};

export const resolveModuleAppWorkflowAction = (input: {
  action: ModuleAppActionConfig;
  runtimeManifest: unknown;
}): ModuleAppWorkflowDefinition => {
  const workflowKey = input.action.runtimeConfig.workflowKey;
  const workflowVersion = input.action.runtimeConfig.workflowVersion;
  if (typeof workflowKey !== 'string' || !Number.isInteger(workflowVersion)) {
    throw new Error('MODULE_APP_WORKFLOW_RUNTIME_REQUIRED');
  }

  const workflows = getRuntime(input.runtimeManifest)?.workflows;
  if (!Array.isArray(workflows)) throw new Error('MODULE_APP_WORKFLOW_RUNTIME_REQUIRED');
  const workflow = workflows.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      'key' in item &&
      item.key === workflowKey &&
      'version' in item &&
      item.version === workflowVersion,
  );
  const parsed = moduleAppWorkflowDefinitionSchema.safeParse(workflow);
  if (!parsed.success) throw new Error('MODULE_APP_WORKFLOW_RUNTIME_REQUIRED');
  return parsed.data;
};

export const resolveModuleAppActionSecrets = async (input: {
  action: ModuleAppActionConfig;
  decrypt: (encryptedValue: string) => Promise<{ plaintext: string; wasAuthentic: boolean }>;
  getEncryptedValue: (input: { installationId: string; key: string }) => Promise<null | string>;
  installationId: string;
}) => {
  const configuredKeys = getModuleAppDeclaredSecretKeys([input.action]);

  const resolved: Record<string, string> = {};
  for (const key of configuredKeys) {
    const encryptedValue = await input.getEncryptedValue({
      installationId: input.installationId,
      key,
    });
    if (!encryptedValue) throw new Error(`MODULE_APP_SECRET_REQUIRED:${key}`);
    const decrypted = await input.decrypt(encryptedValue);
    if (!decrypted.wasAuthentic) throw new Error('MODULE_APP_SECRET_DECRYPT_FAILED');
    resolved[key] = decrypted.plaintext;
  }
  return resolved;
};
