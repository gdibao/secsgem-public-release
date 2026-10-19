import { describe, expect, it } from 'vitest';

import { isMobileConfigurableDestination, resolveMobileDestination } from './destinationRegistry';

describe('mobile destination registry', () => {
  it('classifies workspace, global, and personal mobile destinations', () => {
    expect(resolveMobileDestination('/design')).toMatchObject({ scope: 'workspace' });
    expect(resolveMobileDestination('/engineering-tools?view=favorites')).toMatchObject({ scope: 'workspace' });
    expect(resolveMobileDestination('/apps/market')).toMatchObject({ scope: 'workspace' });
    expect(resolveMobileDestination('/settings/usage')).toMatchObject({ scope: 'personal' });
    expect(resolveMobileDestination('/discover')).toMatchObject({ scope: 'global' });
    expect(resolveMobileDestination('/discover/skill')).toMatchObject({ scope: 'global' });
    expect(resolveMobileDestination('/community/agent/demo')).toMatchObject({ scope: 'global' });
    expect(resolveMobileDestination('/me/profile')).toMatchObject({ scope: 'personal' });
  });

  it('rejects unknown and unsafe routes', () => {
    expect(resolveMobileDestination('/admin')).toBeUndefined();
    expect(resolveMobileDestination('/devtools')).toBeUndefined();
    expect(resolveMobileDestination('javascript:alert(1)')).toBeUndefined();
  });

  it('allows only controlled top-level destinations in admin configuration', () => {
    for (const path of [
      '/',
      '/design',
      '/engineering-tools',
      '/engineering-tools?view=catalog',
      '/engineering-tools?view=favorites',
      '/engineering-tools?view=local_mcp',
      '/discover',
      '/discover/skill',
      '/community',
      '/apps',
      '/tasks',
      '/settings',
      '/settings/plans',
      '/settings/credits',
      '/settings/usage',
    ]) {
      expect(isMobileConfigurableDestination(path), path).toBe(true);
    }
    expect(isMobileConfigurableDestination('/apps/market')).toBe(false);
    expect(isMobileConfigurableDestination('/settings/profile')).toBe(false);
    expect(isMobileConfigurableDestination('/admin')).toBe(false);
    expect(isMobileConfigurableDestination('/engineering-tools/secret')).toBe(false);
    expect(isMobileConfigurableDestination('/engineering-tools?view=admin')).toBe(false);
  });
});
