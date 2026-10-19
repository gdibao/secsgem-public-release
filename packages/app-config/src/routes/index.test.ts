import { describe, expect, it } from 'vitest';

import { getNavigableRoutes, getRouteById } from '.';

describe('navigation routes', () => {
  it('exposes PPT as a navigable creation route', () => {
    expect(getRouteById('ppt')).toMatchObject({
      cmdkKey: 'cmdk.ppt',
      path: '/ppt',
      pathPrefix: '/ppt',
    });

    expect(getNavigableRoutes().map((route) => route.id)).toContain('ppt');
  });

  it('exposes expert plaza as a navigable configured route', () => {
    expect(getRouteById('experts')).toMatchObject({
      cmdkKey: 'cmdk.experts',
      path: '/experts',
      pathPrefix: '/experts',
    });

    expect(getNavigableRoutes().map((route) => route.id)).toContain('experts');
  });
});
