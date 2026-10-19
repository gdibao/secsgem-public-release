import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';
import { PAYMENT_ENVIRONMENT_FALLBACKS } from '@/server/services/payments/environmentFallbacks';

import type { AppSettingLifecycle } from '../types';

type SourceMetadata = {
  defaultSource: string;
  effectiveSource: string[];
};

const databaseSource = (key: AppSettingKey) => `database:${key}`;
const environmentSource = (name: string) => `environment:${name}`;

const environmentFallback = (
  key: AppSettingKey,
  environmentNames: readonly string[],
  includeApplicationDefault = false,
): SourceMetadata => ({
  defaultSource: environmentSource(environmentNames[0]),
  effectiveSource: [
    databaseSource(key),
    ...environmentNames.map(environmentSource),
    ...(includeApplicationDefault ? ['application-default'] : []),
  ],
});

const SOURCE_OVERRIDES: Partial<Record<AppSettingKey, SourceMetadata>> = {
  [APP_SETTING_KEYS.composioApiKey]: environmentFallback(APP_SETTING_KEYS.composioApiKey, [
    'COMPOSIO_API_KEY',
  ]),
  [APP_SETTING_KEYS.composioAuthConfigIds]: environmentFallback(
    APP_SETTING_KEYS.composioAuthConfigIds,
    ['COMPOSIO_AUTH_CONFIG_IDS'],
  ),
  [APP_SETTING_KEYS.composioEnabled]: {
    defaultSource: 'derived:composio.apiKey-or-application-default',
    effectiveSource: [
      databaseSource(APP_SETTING_KEYS.composioEnabled),
      environmentSource('COMPOSIO_ENABLED'),
      databaseSource(APP_SETTING_KEYS.composioApiKey),
      environmentSource('COMPOSIO_API_KEY'),
      'application-default',
    ],
  },
  [APP_SETTING_KEYS.cronSecret]: environmentFallback(APP_SETTING_KEYS.cronSecret, ['CRON_SECRET']),
  [APP_SETTING_KEYS.memoryUserMemoryTriggerMode]: {
    defaultSource: 'application-default',
    effectiveSource: [
      environmentSource('MEMORY_USER_MEMORY_TRIGGER_MODE'),
      databaseSource(APP_SETTING_KEYS.memoryUserMemoryTriggerMode),
      'application-default',
    ],
  },
  [APP_SETTING_KEYS.moduleAppExecutionEnabled]: environmentFallback(
    APP_SETTING_KEYS.moduleAppExecutionEnabled,
    ['MODULE_APP_EXECUTION_ENABLED'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppPublicExecutionEnabled]: environmentFallback(
    APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
    ['MODULE_APP_PUBLIC_EXECUTION_ENABLED'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppRuntimeInternalToken]: environmentFallback(
    APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
    ['MODULE_APP_RUNTIME_INTERNAL_TOKEN'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppRuntimeInternalUrl]: environmentFallback(
    APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
    ['MODULE_APP_RUNTIME_INTERNAL_URL'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled]: environmentFallback(
    APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
    ['MODULE_APP_RUNTIME_INVOCATION_ENABLED'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppRuntimePublicOrigin]: environmentFallback(
    APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
    ['MODULE_APP_RUNTIME_PUBLIC_ORIGIN'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled]: environmentFallback(
    APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
    ['MODULE_APP_SCHEDULE_DISPATCH_ENABLED'],
    true,
  ),
  [APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled]: environmentFallback(
    APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
    ['MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED'],
    true,
  ),
  [APP_SETTING_KEYS.storageS3AccessKeyId]: environmentFallback(
    APP_SETTING_KEYS.storageS3AccessKeyId,
    ['S3_ACCESS_KEY_ID'],
  ),
  [APP_SETTING_KEYS.storageS3Bucket]: environmentFallback(APP_SETTING_KEYS.storageS3Bucket, [
    'S3_BUCKET',
  ]),
  [APP_SETTING_KEYS.storageS3EnablePathStyle]: environmentFallback(
    APP_SETTING_KEYS.storageS3EnablePathStyle,
    ['S3_ENABLE_PATH_STYLE'],
    true,
  ),
  [APP_SETTING_KEYS.storageS3Endpoint]: environmentFallback(APP_SETTING_KEYS.storageS3Endpoint, [
    'S3_ENDPOINT',
  ]),
  [APP_SETTING_KEYS.storageS3FilePath]: environmentFallback(
    APP_SETTING_KEYS.storageS3FilePath,
    ['NEXT_PUBLIC_S3_FILE_PATH'],
    true,
  ),
  [APP_SETTING_KEYS.storageS3PreviewUrlExpireIn]: environmentFallback(
    APP_SETTING_KEYS.storageS3PreviewUrlExpireIn,
    ['S3_PREVIEW_URL_EXPIRE_IN'],
    true,
  ),
  [APP_SETTING_KEYS.storageS3PublicDomain]: environmentFallback(
    APP_SETTING_KEYS.storageS3PublicDomain,
    ['S3_PUBLIC_DOMAIN', 'NEXT_PUBLIC_S3_DOMAIN'],
  ),
  [APP_SETTING_KEYS.storageS3Region]: environmentFallback(APP_SETTING_KEYS.storageS3Region, [
    'S3_REGION',
  ]),
  [APP_SETTING_KEYS.storageS3SecretAccessKey]: environmentFallback(
    APP_SETTING_KEYS.storageS3SecretAccessKey,
    ['S3_SECRET_ACCESS_KEY'],
  ),
  [APP_SETTING_KEYS.storageS3SetAcl]: environmentFallback(
    APP_SETTING_KEYS.storageS3SetAcl,
    ['S3_SET_ACL'],
    true,
  ),
};

export const getAppSettingSourceMetadata = (
  key: AppSettingKey,
  lifecycle: AppSettingLifecycle,
): SourceMetadata => {
  if (lifecycle === 'external') {
    return {
      defaultSource: 'external:CI/GitHub Secrets',
      effectiveSource: ['external:CI/GitHub Secrets'],
    };
  }

  if (lifecycle === 'deprecated') {
    return {
      defaultSource: 'application-default',
      effectiveSource: ['application-default'],
    };
  }

  const paymentEnvironmentNames = PAYMENT_ENVIRONMENT_FALLBACKS[key];
  if (paymentEnvironmentNames) {
    return environmentFallback(key, paymentEnvironmentNames, true);
  }

  return (
    SOURCE_OVERRIDES[key] ?? {
      defaultSource: 'application-default',
      effectiveSource: [databaseSource(key), 'application-default'],
    }
  );
};
