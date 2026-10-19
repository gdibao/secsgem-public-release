import { describe, expect, it } from 'vitest';

import { viteNodeModuleStub } from './nodeModuleStub';

describe('viteNodeModuleStub', () => {
  it('only applies browser stubs to the client build environment', () => {
    const plugin = viteNodeModuleStub();
    const applies = plugin.applyToEnvironment;

    expect(applies).toBeTypeOf('function');
    expect(applies?.({ name: 'client' } as never)).toBe(true);
    expect(applies?.({ name: 'ssr' } as never)).toBe(false);
  });
});
