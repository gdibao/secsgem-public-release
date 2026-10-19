// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const keys = [
  'MODULE_APP_RUNTIME_INVOCATION_ENABLED',
  'MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED',
  'MODULE_APP_SCHEDULE_DISPATCH_ENABLED',
  'MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED',
  'MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED',
  'MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED',
  'MODULE_APP_PUBLIC_EXECUTION_ENABLED',
  'MODULE_APP_RUNTIME_APP_ALLOWLIST',
  'MODULE_APP_PUBLISHER_ALLOWLIST',
] as const;

afterEach(() => {
  for (const key of keys) delete process.env[key];
  vi.resetModules();
});
describe('module app production controls environment', () => {
  it('defaults every mutation flag and rollout list to disabled', async () => {
    const { getAppConfig } = await import('../app');

    expect(getAppConfig()).toMatchObject({
      MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED: false,
      MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED: false,
      MODULE_APP_PUBLIC_EXECUTION_ENABLED: false,
      MODULE_APP_PUBLISHER_ALLOWLIST: [],
      MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED: false,
      MODULE_APP_RUNTIME_APP_ALLOWLIST: [],
      MODULE_APP_RUNTIME_INVOCATION_ENABLED: false,
      MODULE_APP_SCHEDULE_DISPATCH_ENABLED: false,
      MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED: false,
    });
  });

  it('parses independent flags and bounded comma-separated allowlists', async () => {
    for (const key of keys.slice(0, 7)) process.env[key] = 'true';
    process.env.MODULE_APP_RUNTIME_APP_ALLOWLIST = ' app-1,app-2,app-1 ';
    process.env.MODULE_APP_PUBLISHER_ALLOWLIST = ' publisher-1 , publisher-2 ';
    vi.resetModules();
    const { getAppConfig } = await import('../app');

    expect(getAppConfig()).toMatchObject({
      MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED: true,
      MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED: true,
      MODULE_APP_PUBLIC_EXECUTION_ENABLED: true,
      MODULE_APP_PUBLISHER_ALLOWLIST: ['publisher-1', 'publisher-2'],
      MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED: true,
      MODULE_APP_RUNTIME_APP_ALLOWLIST: ['app-1', 'app-2'],
      MODULE_APP_RUNTIME_INVOCATION_ENABLED: true,
      MODULE_APP_SCHEDULE_DISPATCH_ENABLED: true,
      MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED: true,
    });
  });
});
