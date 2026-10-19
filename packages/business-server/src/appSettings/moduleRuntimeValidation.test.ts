import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';

import { validateModuleAppRuntimeSettingUpdates } from './moduleRuntimeValidation';

const healthCheck = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/appSettings/secrets', () => ({
  decryptAppSettingSecret: vi.fn(async (_key: string, value: unknown) => value),
}));

vi.mock('@/server/services/moduleAppRuntime/client', () => ({
  ModuleAppRuntimeClient: vi.fn(() => ({ healthCheck })),
}));

const createDb = (rows: Array<{ key: string; value: unknown }> = []) =>
  ({
    query: {
      appSettings: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    },
  }) as any;

const completeRuntimeUpdates = [
  { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: true },
  { key: APP_SETTING_KEYS.moduleAppRuntimeInternalUrl, value: 'http://module-runtime:3210' },
  { key: APP_SETTING_KEYS.moduleAppRuntimeInternalToken, value: 'runtime-token' },
  { key: APP_SETTING_KEYS.moduleAppRuntimePublicOrigin, value: 'https://runtime.example.com' },
];

describe('validateModuleAppRuntimeSettingUpdates', () => {
  beforeEach(() => {
    healthCheck.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects public execution when connection prerequisites are missing', async () => {
    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: true },
        { key: APP_SETTING_KEYS.moduleAppPublicExecutionEnabled, value: true },
      ]),
    ).rejects.toMatchObject({ message: 'MODULE_APP_PUBLIC_EXECUTION_CONFIG_REQUIRED' });
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('always permits an explicit master shutdown without probing latent child switches', async () => {
    const db = createDb([
      { key: APP_SETTING_KEYS.moduleAppPublicExecutionEnabled, value: true },
      { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
      { key: APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled, value: true },
      { key: APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled, value: true },
    ]);

    await expect(
      validateModuleAppRuntimeSettingUpdates(db, [
        { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: false },
      ]),
    ).resolves.toBeUndefined();
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('still rejects explicitly enabling a child switch during a master shutdown', async () => {
    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: false },
        { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
      ]),
    ).rejects.toMatchObject({ message: 'MODULE_APP_RUNTIME_INVOCATION_REQUIRES_EXECUTION' });
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('rejects activation while the configured runtime is unavailable', async () => {
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_PUBLIC_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'runtime-token');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_URL', 'http://module-runtime:3210');
    vi.stubEnv('MODULE_APP_RUNTIME_PUBLIC_ORIGIN', 'https://runtime.example.com');
    healthCheck.mockResolvedValue({
      code: 'MODULE_APP_RUNTIME_UNREACHABLE',
      status: 'unavailable',
    });

    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        ...completeRuntimeUpdates,
        { key: APP_SETTING_KEYS.moduleAppPublicExecutionEnabled, value: true },
      ]),
    ).rejects.toMatchObject({ message: 'MODULE_APP_RUNTIME_NOT_READY' });
  });

  it('reports an actionable error when the Runtime rejects the configured token', async () => {
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'runtime-token');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_URL', 'http://module-runtime:3210');
    vi.stubEnv('MODULE_APP_RUNTIME_PUBLIC_ORIGIN', 'https://runtime.example.com');
    healthCheck.mockResolvedValue({
      code: 'MODULE_APP_RUNTIME_AUTH_FAILED',
      status: 'unavailable',
    });

    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        ...completeRuntimeUpdates,
        { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
      ]),
    ).rejects.toMatchObject({ message: 'MODULE_APP_RUNTIME_AUTH_FAILED' });
  });

  it('uses legacy connection credentials when no database override exists', async () => {
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'legacy-runtime-token');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_URL', 'http://legacy-runtime:3210');
    healthCheck.mockResolvedValue({ status: 'ready' });

    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        { key: APP_SETTING_KEYS.moduleAppExecutionEnabled, value: true },
        { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
      ]),
    ).resolves.toBeUndefined();
    expect(healthCheck).toHaveBeenCalledOnce();
  });

  it('accepts activation after the runtime readiness probe succeeds', async () => {
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_PUBLIC_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'runtime-token');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_URL', 'http://module-runtime:3210');
    vi.stubEnv('MODULE_APP_RUNTIME_PUBLIC_ORIGIN', 'https://runtime.example.com');
    healthCheck.mockResolvedValue({ status: 'ready' });

    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        ...completeRuntimeUpdates,
        { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
        { key: APP_SETTING_KEYS.moduleAppPublicExecutionEnabled, value: true },
      ]),
    ).resolves.toBeUndefined();
    expect(healthCheck).toHaveBeenCalledOnce();
  });

  it('rejects database-only runtime activation until the worker environment is updated', async () => {
    await expect(
      validateModuleAppRuntimeSettingUpdates(createDb(), [
        ...completeRuntimeUpdates,
        { key: APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled, value: true },
      ]),
    ).rejects.toMatchObject({ message: 'MODULE_APP_RUNTIME_CONFIG_SOURCE_MISMATCH' });
    expect(healthCheck).not.toHaveBeenCalled();
  });
});
