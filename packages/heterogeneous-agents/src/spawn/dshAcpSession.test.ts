import { describe, expect, it } from 'vitest';

import { buildDshAcpArgs } from './dshAcpSession';

describe('DeepSeek Harness ACP launch', () => {
  it('always selects the official ACP profile', () => {
    expect(buildDshAcpArgs()).toEqual(['--profile', 'acp']);
    expect(buildDshAcpArgs(['--verbose'])).toEqual(['--profile', 'acp', '--verbose']);
  });

  it('never falls back to the legacy headless profile', () => {
    expect(buildDshAcpArgs()).not.toContain('headless');
  });
});
