import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';

export const MODULE_APP_RUNTIME_SETTING_KEYS = [
  APP_SETTING_KEYS.moduleAppExecutionEnabled,
  APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
  APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
  APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
  APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
  APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
  APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
  APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
] as const;

export type ModuleAppRuntimeSettingKey = (typeof MODULE_APP_RUNTIME_SETTING_KEYS)[number];
export type ModuleAppRuntimeSettingSource = 'database' | 'default' | 'environment';

export type ModuleAppRuntimeEnvironment = {
  executionEnabled?: boolean | string;
  internalToken?: string;
  internalUrl?: string;
  invocationEnabled?: boolean | string;
  publicExecutionEnabled?: boolean | string;
  publicOrigin?: string;
  scheduleDispatchEnabled?: boolean | string;
  workflowPrivilegedExecutorsEnabled?: boolean | string;
};

const readBooleanEnvironment = (environment: Record<string, string | undefined>, key: string) =>
  Object.hasOwn(environment, key) ? environment[key] === 'true' : undefined;

export const readModuleAppRuntimeEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): ModuleAppRuntimeEnvironment => ({
  executionEnabled: readBooleanEnvironment(environment, 'MODULE_APP_EXECUTION_ENABLED'),
  internalToken: environment.MODULE_APP_RUNTIME_INTERNAL_TOKEN,
  internalUrl: environment.MODULE_APP_RUNTIME_INTERNAL_URL,
  invocationEnabled: readBooleanEnvironment(environment, 'MODULE_APP_RUNTIME_INVOCATION_ENABLED'),
  publicExecutionEnabled: readBooleanEnvironment(
    environment,
    'MODULE_APP_PUBLIC_EXECUTION_ENABLED',
  ),
  publicOrigin: environment.MODULE_APP_RUNTIME_PUBLIC_ORIGIN,
  scheduleDispatchEnabled: readBooleanEnvironment(
    environment,
    'MODULE_APP_SCHEDULE_DISPATCH_ENABLED',
  ),
  workflowPrivilegedExecutorsEnabled: readBooleanEnvironment(
    environment,
    'MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED',
  ),
});

export type ResolvedModuleAppRuntimeConfig = {
  blockers: {
    invocation: string[];
    publicExecution: string[];
    scheduleDispatch: string[];
    workflowPrivilegedExecutors: string[];
  };
  configuration: {
    internalTokenConfigured: boolean;
    internalUrlConfigured: boolean;
    publicOriginConfigured: boolean;
  };
  configurationMismatch: string[];
  connections: {
    internalToken?: string;
    internalUrl?: string;
    publicOrigin?: string;
  };
  legacyEnvironmentKeys: string[];
  requestedSwitches: {
    executionEnabled: boolean;
    invocationEnabled: boolean;
    publicExecutionEnabled: boolean;
    scheduleDispatchEnabled: boolean;
    workflowPrivilegedExecutorsEnabled: boolean;
  };
  sources: {
    executionEnabled: ModuleAppRuntimeSettingSource;
    internalToken: ModuleAppRuntimeSettingSource;
    internalUrl: ModuleAppRuntimeSettingSource;
    invocationEnabled: ModuleAppRuntimeSettingSource;
    publicExecutionEnabled: ModuleAppRuntimeSettingSource;
    publicOrigin: ModuleAppRuntimeSettingSource;
    scheduleDispatchEnabled: ModuleAppRuntimeSettingSource;
    workflowPrivilegedExecutorsEnabled: ModuleAppRuntimeSettingSource;
  };
  switches: {
    executionEnabled: boolean;
    invocationEnabled: boolean;
    publicExecutionEnabled: boolean;
    scheduleDispatchEnabled: boolean;
    workflowPrivilegedExecutorsEnabled: boolean;
  };
};

type Resolution<T> = {
  environmentKey?: string;
  source: ModuleAppRuntimeSettingSource;
  value: T;
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
};

const resolveBoolean = (input: {
  databasePresent: boolean;
  databaseValue: unknown;
  environmentKey: string;
  environmentValue: unknown;
}): Resolution<boolean> => {
  if (input.databasePresent) {
    return { source: 'database', value: parseBoolean(input.databaseValue) ?? false };
  }

  const environmentValue = parseBoolean(input.environmentValue);
  if (environmentValue !== undefined) {
    return {
      environmentKey: input.environmentKey,
      source: 'environment',
      value: environmentValue,
    };
  }

  return { source: 'default', value: false };
};

const resolveString = (input: {
  databasePresent: boolean;
  databaseValue: unknown;
  environmentKey: string;
  environmentValue: unknown;
}): Resolution<string | undefined> => {
  if (input.databasePresent) {
    return {
      source: 'database',
      value:
        typeof input.databaseValue === 'string' && input.databaseValue.trim()
          ? input.databaseValue
          : undefined,
    };
  }
  if (typeof input.environmentValue === 'string' && input.environmentValue.trim()) {
    return {
      environmentKey: input.environmentKey,
      source: 'environment',
      value: input.environmentValue,
    };
  }

  return { source: 'default', value: undefined };
};

const normalizeInternalOrigin = (value?: string) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return;
    return url.origin;
  } catch {
    return;
  }
};

const normalizePublicOrigin = (value?: string) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.protocol !== 'https:') return;
    return url.origin;
  } catch {
    return;
  }
};

export const resolveModuleAppRuntimeConfig = (input: {
  environment?: ModuleAppRuntimeEnvironment;
  requireEnvironmentParity?: boolean;
  values?: Partial<Record<AppSettingKey, unknown>>;
}): ResolvedModuleAppRuntimeConfig => {
  const environment = input.environment ?? {};
  const values = input.values ?? {};
  const executionEnabled = resolveBoolean({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppExecutionEnabled),
    databaseValue: values[APP_SETTING_KEYS.moduleAppExecutionEnabled],
    environmentKey: 'MODULE_APP_EXECUTION_ENABLED',
    environmentValue: environment.executionEnabled,
  });
  const publicExecutionEnabled = resolveBoolean({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppPublicExecutionEnabled),
    databaseValue: values[APP_SETTING_KEYS.moduleAppPublicExecutionEnabled],
    environmentKey: 'MODULE_APP_PUBLIC_EXECUTION_ENABLED',
    environmentValue: environment.publicExecutionEnabled,
  });
  const invocationEnabled = resolveBoolean({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled),
    databaseValue: values[APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled],
    environmentKey: 'MODULE_APP_RUNTIME_INVOCATION_ENABLED',
    environmentValue: environment.invocationEnabled,
  });
  const scheduleDispatchEnabled = resolveBoolean({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled),
    databaseValue: values[APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled],
    environmentKey: 'MODULE_APP_SCHEDULE_DISPATCH_ENABLED',
    environmentValue: environment.scheduleDispatchEnabled,
  });
  const workflowPrivilegedExecutorsEnabled = resolveBoolean({
    databasePresent: Object.hasOwn(
      values,
      APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
    ),
    databaseValue: values[APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled],
    environmentKey: 'MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED',
    environmentValue: environment.workflowPrivilegedExecutorsEnabled,
  });
  const internalToken = resolveString({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppRuntimeInternalToken),
    databaseValue: values[APP_SETTING_KEYS.moduleAppRuntimeInternalToken],
    environmentKey: 'MODULE_APP_RUNTIME_INTERNAL_TOKEN',
    environmentValue: environment.internalToken,
  });
  const internalUrl = resolveString({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppRuntimeInternalUrl),
    databaseValue: values[APP_SETTING_KEYS.moduleAppRuntimeInternalUrl],
    environmentKey: 'MODULE_APP_RUNTIME_INTERNAL_URL',
    environmentValue: environment.internalUrl,
  });
  const publicOrigin = resolveString({
    databasePresent: Object.hasOwn(values, APP_SETTING_KEYS.moduleAppRuntimePublicOrigin),
    databaseValue: values[APP_SETTING_KEYS.moduleAppRuntimePublicOrigin],
    environmentKey: 'MODULE_APP_RUNTIME_PUBLIC_ORIGIN',
    environmentValue: environment.publicOrigin,
  });
  const normalizedInternalUrl = normalizeInternalOrigin(internalUrl.value);
  const normalizedPublicOrigin = normalizePublicOrigin(publicOrigin.value);
  const internalTokenConfigured = Boolean(internalToken.value?.trim());
  const internalUrlConfigured = Boolean(normalizedInternalUrl);
  const publicOriginConfigured = Boolean(normalizedPublicOrigin);
  const environmentOnlyConfig = input.requireEnvironmentParity
    ? resolveModuleAppRuntimeConfig({ environment })
    : undefined;
  const parityValues = [
    [
      APP_SETTING_KEYS.moduleAppExecutionEnabled,
      executionEnabled.value,
      environmentOnlyConfig?.requestedSwitches.executionEnabled,
    ],
    [
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      internalToken.value,
      environmentOnlyConfig?.connections.internalToken,
    ],
    [
      APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
      invocationEnabled.value,
      environmentOnlyConfig?.requestedSwitches.invocationEnabled,
    ],
  ] as const;
  const configurationMismatch = input.requireEnvironmentParity
    ? parityValues
        .filter(
          ([key, value, environmentValue]) =>
            Object.hasOwn(values, key) && !Object.is(value, environmentValue),
        )
        .map(([key]) => key)
    : [];
  const configurationSourceBlocker = configurationMismatch.length
    ? ['configuration-source-mismatch']
    : [];
  const executionBlocker = executionEnabled.value
    ? configurationSourceBlocker
    : ['execution-disabled'];
  const runtimeConnectionBlockers = [
    ...(!internalUrlConfigured ? ['internal-url-missing'] : []),
    ...(!internalTokenConfigured ? ['internal-token-missing'] : []),
  ];
  const invocationBlockers = [...executionBlocker, ...runtimeConnectionBlockers];
  const publicExecutionBlockers = [
    ...executionBlocker,
    ...runtimeConnectionBlockers,
    ...(!publicOriginConfigured ? ['public-origin-missing'] : []),
  ];

  const resolutions = [
    executionEnabled,
    publicExecutionEnabled,
    invocationEnabled,
    scheduleDispatchEnabled,
    workflowPrivilegedExecutorsEnabled,
    internalToken,
    internalUrl,
    publicOrigin,
  ];

  return {
    blockers: {
      invocation: invocationBlockers,
      publicExecution: publicExecutionBlockers,
      scheduleDispatch: executionBlocker,
      workflowPrivilegedExecutors: executionBlocker,
    },
    configuration: {
      internalTokenConfigured,
      internalUrlConfigured,
      publicOriginConfigured,
    },
    configurationMismatch,
    connections: {
      ...(internalToken.value ? { internalToken: internalToken.value } : {}),
      ...(normalizedInternalUrl ? { internalUrl: normalizedInternalUrl } : {}),
      ...(normalizedPublicOrigin ? { publicOrigin: normalizedPublicOrigin } : {}),
    },
    legacyEnvironmentKeys: Array.from(
      new Set(
        resolutions.flatMap((resolution) =>
          resolution.source === 'environment' && resolution.environmentKey
            ? [resolution.environmentKey]
            : [],
        ),
      ),
    ),
    requestedSwitches: {
      executionEnabled: executionEnabled.value,
      invocationEnabled: invocationEnabled.value,
      publicExecutionEnabled: publicExecutionEnabled.value,
      scheduleDispatchEnabled: scheduleDispatchEnabled.value,
      workflowPrivilegedExecutorsEnabled: workflowPrivilegedExecutorsEnabled.value,
    },
    sources: {
      executionEnabled: executionEnabled.source,
      internalToken: internalToken.source,
      internalUrl: internalUrl.source,
      invocationEnabled: invocationEnabled.source,
      publicExecutionEnabled: publicExecutionEnabled.source,
      publicOrigin: publicOrigin.source,
      scheduleDispatchEnabled: scheduleDispatchEnabled.source,
      workflowPrivilegedExecutorsEnabled: workflowPrivilegedExecutorsEnabled.source,
    },
    switches: {
      executionEnabled: executionEnabled.value && configurationMismatch.length === 0,
      invocationEnabled: invocationEnabled.value && invocationBlockers.length === 0,
      publicExecutionEnabled: publicExecutionEnabled.value && publicExecutionBlockers.length === 0,
      scheduleDispatchEnabled: scheduleDispatchEnabled.value && executionBlocker.length === 0,
      workflowPrivilegedExecutorsEnabled:
        workflowPrivilegedExecutorsEnabled.value && executionBlocker.length === 0,
    },
  };
};
