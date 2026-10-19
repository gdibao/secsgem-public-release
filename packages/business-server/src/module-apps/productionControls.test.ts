import { describe, expect, it } from 'vitest';

import {
  assertModuleAppMutationEnabled,
  assertModuleAppRolloutAllowed,
} from './productionControls';

describe('module app production controls', () => {
  it('fails closed for disabled mutation flags', () => {
    expect(() =>
      assertModuleAppMutationEnabled(false, 'MODULE_APP_PAYMENT_CREATION_DISABLED'),
    ).toThrow('MODULE_APP_PAYMENT_CREATION_DISABLED');
    expect(() =>
      assertModuleAppMutationEnabled(true, 'MODULE_APP_PAYMENT_CREATION_DISABLED'),
    ).not.toThrow();
  });

  it('allows an explicitly listed application or publisher and rejects everything else', () => {
    const rollout = { appIds: ['app-1'], publisherIds: ['publisher-1'] };
    expect(() =>
      assertModuleAppRolloutAllowed({ appId: 'app-1', publisherId: null }, rollout),
    ).not.toThrow();
    expect(() =>
      assertModuleAppRolloutAllowed({ appId: 'app-2', publisherId: 'publisher-1' }, rollout),
    ).not.toThrow();
    expect(() =>
      assertModuleAppRolloutAllowed({ appId: 'app-2', publisherId: 'publisher-2' }, rollout),
    ).toThrow('MODULE_APP_ROLLOUT_NOT_ALLOWED');
  });

  it('keeps an empty rollout fail-closed', () => {
    expect(() =>
      assertModuleAppRolloutAllowed(
        { appId: 'app-1', publisherId: 'publisher-1' },
        { appIds: [], publisherIds: [] },
      ),
    ).toThrow('MODULE_APP_ROLLOUT_NOT_ALLOWED');
  });
});
