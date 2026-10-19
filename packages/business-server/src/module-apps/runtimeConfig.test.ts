import { describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';

import { readModuleAppRuntimeEnvironment, resolveModuleAppRuntimeConfig } from './runtimeConfig';

describe('resolveModuleAppRuntimeConfig', () => {
  it('distinguishes absent legacy switches from explicit false environment values', () => {
    const defaults = resolveModuleAppRuntimeConfig({
      environment: readModuleAppRuntimeEnvironment({}),
    });
    const explicitFalse = resolveModuleAppRuntimeConfig({
      environment: readModuleAppRuntimeEnvironment({ MODULE_APP_EXECUTION_ENABLED: 'false' }),
    });

    expect(defaults.sources.executionEnabled).toBe('default');
    expect(defaults.legacyEnvironmentKeys).toEqual([]);
    expect(explicitFalse.sources.executionEnabled).toBe('environment');
    expect(explicitFalse.legacyEnvironmentKeys).toEqual(['MODULE_APP_EXECUTION_ENABLED']);
  });

  it('fails closed when legacy environment switches request public runtime without configuration', () => {
    const config = resolveModuleAppRuntimeConfig({
      environment: {
        executionEnabled: true,
        invocationEnabled: true,
        publicExecutionEnabled: true,
      },
    });

    expect(config.requestedSwitches).toMatchObject({
      executionEnabled: true,
      invocationEnabled: true,
      publicExecutionEnabled: true,
    });
    expect(config.switches).toMatchObject({
      executionEnabled: true,
      invocationEnabled: false,
      publicExecutionEnabled: false,
    });
    expect(config.blockers.publicExecution).toEqual([
      'internal-url-missing',
      'internal-token-missing',
      'public-origin-missing',
    ]);
  });

  it('lets explicit database false values override legacy true environment flags', () => {
    const config = resolveModuleAppRuntimeConfig({
      environment: {
        executionEnabled: true,
        invocationEnabled: true,
        publicExecutionEnabled: true,
        scheduleDispatchEnabled: true,
        workflowPrivilegedExecutorsEnabled: true,
      },
      values: {
        [APP_SETTING_KEYS.moduleAppExecutionEnabled]: false,
        [APP_SETTING_KEYS.moduleAppPublicExecutionEnabled]: false,
        [APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled]: false,
        [APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled]: false,
        [APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled]: false,
      },
    });

    expect(config.requestedSwitches).toEqual({
      executionEnabled: false,
      invocationEnabled: false,
      publicExecutionEnabled: false,
      scheduleDispatchEnabled: false,
      workflowPrivilegedExecutorsEnabled: false,
    });
    expect(config.legacyEnvironmentKeys).toEqual([]);
    expect(config.sources.executionEnabled).toBe('database');
  });

  it('does not revive environment values when stored settings are empty or malformed', () => {
    const config = resolveModuleAppRuntimeConfig({
      environment: {
        executionEnabled: true,
        internalUrl: 'http://legacy-runtime:3210',
        publicOrigin: 'https://legacy-runtime.example.com',
      },
      values: {
        [APP_SETTING_KEYS.moduleAppExecutionEnabled]: 'invalid',
        [APP_SETTING_KEYS.moduleAppRuntimeInternalUrl]: '',
        [APP_SETTING_KEYS.moduleAppRuntimePublicOrigin]: null,
      },
    });

    expect(config.requestedSwitches.executionEnabled).toBe(false);
    expect(config.connections.internalUrl).toBeUndefined();
    expect(config.connections.publicOrigin).toBeUndefined();
    expect(config.sources).toMatchObject({
      executionEnabled: 'database',
      internalUrl: 'database',
      publicOrigin: 'database',
    });
    expect(config.legacyEnvironmentKeys).toEqual([]);
  });

  it('enables every effective switch only after connection prerequisites are complete', () => {
    const config = resolveModuleAppRuntimeConfig({
      values: {
        [APP_SETTING_KEYS.moduleAppExecutionEnabled]: true,
        [APP_SETTING_KEYS.moduleAppPublicExecutionEnabled]: true,
        [APP_SETTING_KEYS.moduleAppRuntimeInternalToken]: 'runtime-token',
        [APP_SETTING_KEYS.moduleAppRuntimeInternalUrl]: 'http://module-runtime:3210/path',
        [APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled]: true,
        [APP_SETTING_KEYS.moduleAppRuntimePublicOrigin]: 'https://runtime.example.com/assets',
        [APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled]: true,
        [APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled]: true,
      },
    });

    expect(config.connections).toEqual({
      internalToken: 'runtime-token',
      internalUrl: 'http://module-runtime:3210',
      publicOrigin: 'https://runtime.example.com',
    });
    expect(config.switches).toEqual({
      executionEnabled: true,
      invocationEnabled: true,
      publicExecutionEnabled: true,
      scheduleDispatchEnabled: true,
      workflowPrivilegedExecutorsEnabled: true,
    });
  });

  it('fails closed when database runtime settings are not published to the worker environment', () => {
    const config = resolveModuleAppRuntimeConfig({
      requireEnvironmentParity: true,
      environment: readModuleAppRuntimeEnvironment({}),
      values: {
        [APP_SETTING_KEYS.moduleAppExecutionEnabled]: true,
        [APP_SETTING_KEYS.moduleAppRuntimeInternalToken]: 'runtime-token',
        [APP_SETTING_KEYS.moduleAppRuntimeInternalUrl]: 'http://module-runtime:3210',
        [APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled]: true,
      },
    });

    expect(config.configurationMismatch).toEqual([
      APP_SETTING_KEYS.moduleAppExecutionEnabled,
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
    ]);
    expect(config.switches).toMatchObject({
      executionEnabled: false,
      invocationEnabled: false,
    });
    expect(config.blockers.invocation).toContain('configuration-source-mismatch');
  });
});
