import { describe, expect, it } from 'vitest';

import { shouldAutoStartCasdoor } from './autoCasdoor';

const defaults = {
  inProgress: false,
  preferEmail: false,
  providerAvailable: true,
  ready: true,
  started: false,
};

describe('shouldAutoStartCasdoor', () => {
  it('starts the default WeChat flow when Casdoor is ready', () => {
    expect(shouldAutoStartCasdoor(defaults)).toBe(true);
  });

  it.each([
    ['the user selected email', { preferEmail: true }],
    ['the provider is unavailable', { providerAvailable: false }],
    ['configuration is still loading', { ready: false }],
    ['an OAuth request is in progress', { inProgress: true }],
    ['this page mount already attempted OAuth', { started: true }],
  ])('does not auto-start when %s', (_, overrides) => {
    expect(shouldAutoStartCasdoor({ ...defaults, ...overrides })).toBe(false);
  });
});
