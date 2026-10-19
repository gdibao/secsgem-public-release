// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getServerAuthConfig } from './getServerAuthConfig';

describe('getServerAuthConfig', () => {
  it('exposes ComHub business features so user subscription pages are visible', () => {
    expect(getServerAuthConfig().enableBusinessFeatures).toBe(true);
  });
});
