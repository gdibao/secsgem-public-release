import { TRPCError } from '@trpc/server';

import {
  MODULE_APP_RUNTIME_SETTING_KEYS,
  readModuleAppRuntimeEnvironment,
  resolveModuleAppRuntimeConfig,
} from '@/business/server/module-apps/runtimeConfig';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import type { LobeChatDatabase } from '@/database/type';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';
import { ModuleAppRuntimeClient } from '@/server/services/moduleAppRuntime/client';

import { loadAppSettingsSnapshot } from './loader';

type ModuleAppRuntimeSettingUpdate = {
  key: string;
  value?: unknown;
};

const runtimeSettingKeys = new Set<string>(MODULE_APP_RUNTIME_SETTING_KEYS);
const runtimeDependentSwitchKeys = new Set<string>([
  APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
  APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
  APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
  APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
]);

export const validateModuleAppRuntimeSettingUpdates = async (
  db: LobeChatDatabase,
  updates: ModuleAppRuntimeSettingUpdate[],
) => {
  const runtimeUpdates = updates.filter((update) => runtimeSettingKeys.has(update.key));
  if (runtimeUpdates.length === 0) return;

  const snapshot = await loadAppSettingsSnapshot(db, MODULE_APP_RUNTIME_SETTING_KEYS);
  const values = Object.fromEntries(snapshot.entries().filter(([key]) => snapshot.has(key)));
  if (snapshot.has(APP_SETTING_KEYS.moduleAppRuntimeInternalToken)) {
    values[APP_SETTING_KEYS.moduleAppRuntimeInternalToken] = await decryptAppSettingSecret(
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      snapshot.get(APP_SETTING_KEYS.moduleAppRuntimeInternalToken),
    );
  }

  for (const update of runtimeUpdates) {
    values[update.key] =
      update.key === APP_SETTING_KEYS.moduleAppRuntimeInternalToken
        ? await decryptAppSettingSecret(
            APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
            update.value,
          )
        : update.value;
  }

  const config = resolveModuleAppRuntimeConfig({
    environment: readModuleAppRuntimeEnvironment(),
    requireEnvironmentParity: true,
    values,
  });
  const requested = config.requestedSwitches;
  const invocationBlockers = config.blockers.invocation.filter(
    (blocker) => blocker !== 'configuration-source-mismatch',
  );
  const publicExecutionBlockers = config.blockers.publicExecution.filter(
    (blocker) => blocker !== 'configuration-source-mismatch',
  );
  const explicitlyDisablesExecution = runtimeUpdates.some(
    (update) => update.key === APP_SETTING_KEYS.moduleAppExecutionEnabled && update.value === false,
  );
  const explicitlyEnablesDependentSwitch = runtimeUpdates.some(
    (update) => runtimeDependentSwitchKeys.has(update.key) && update.value === true,
  );

  if (explicitlyDisablesExecution && !explicitlyEnablesDependentSwitch) return;

  if (!requested.executionEnabled && requested.publicExecutionEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_PUBLIC_EXECUTION_REQUIRES_EXECUTION',
    });
  }
  if (!requested.executionEnabled && requested.invocationEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_RUNTIME_INVOCATION_REQUIRES_EXECUTION',
    });
  }
  if (!requested.executionEnabled && requested.scheduleDispatchEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_SCHEDULE_DISPATCH_REQUIRES_EXECUTION',
    });
  }
  if (!requested.executionEnabled && requested.workflowPrivilegedExecutorsEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_WORKFLOW_EXECUTORS_REQUIRE_EXECUTION',
    });
  }
  if (requested.publicExecutionEnabled && publicExecutionBlockers.length > 0) {
    throw new TRPCError({
      cause: { blockers: publicExecutionBlockers },
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_PUBLIC_EXECUTION_CONFIG_REQUIRED',
    });
  }
  if (requested.invocationEnabled && invocationBlockers.length > 0) {
    throw new TRPCError({
      cause: { blockers: invocationBlockers },
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_RUNTIME_INVOCATION_CONFIG_REQUIRED',
    });
  }

  if (config.configurationMismatch.length > 0) {
    throw new TRPCError({
      cause: { keys: config.configurationMismatch },
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_RUNTIME_CONFIG_SOURCE_MISMATCH',
    });
  }

  if (!requested.publicExecutionEnabled && !requested.invocationEnabled) return;

  const probe = await new ModuleAppRuntimeClient({
    baseUrl: config.connections.internalUrl,
    enabled: requested.executionEnabled,
    internalToken: config.connections.internalToken,
    invocationEnabled: requested.invocationEnabled,
  }).healthCheck();
  if (probe.status !== 'ready') {
    const runtimeCode = probe.status === 'unavailable' ? probe.code : undefined;
    throw new TRPCError({
      cause: { runtimeCode },
      code: 'BAD_REQUEST',
      message:
        runtimeCode === 'MODULE_APP_RUNTIME_AUTH_FAILED'
          ? 'MODULE_APP_RUNTIME_AUTH_FAILED'
          : 'MODULE_APP_RUNTIME_NOT_READY',
    });
  }
};
