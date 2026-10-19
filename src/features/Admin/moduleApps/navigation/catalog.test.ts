import { describe, expect, it } from 'vitest';

import {
  findModuleAdminSectionByPath,
  MODULE_ADMIN_ROUTE_PATHS,
  MODULE_ADMIN_SECTIONS,
  MODULE_APP_DETAIL_SECTIONS,
} from './catalog';

describe('module admin navigation catalog', () => {
  it('generates absolute paths from the module route tree', () => {
    expect(MODULE_ADMIN_ROUTE_PATHS['module-overview']).toBe('/settings/admin/modules');
    expect(MODULE_ADMIN_ROUTE_PATHS['module-app-configuration']).toBe(
      '/settings/admin/modules/apps/:appId/configuration',
    );
  });

  it('matches the most specific section path', () => {
    expect(findModuleAdminSectionByPath('/settings/admin/modules/apps/abc/products')?.id).toBe(
      'module-app-products',
    );
  });

  it('maps every section route ID to a generated path', () => {
    for (const section of [...MODULE_ADMIN_SECTIONS, ...MODULE_APP_DETAIL_SECTIONS]) {
      expect(MODULE_ADMIN_ROUTE_PATHS[section.id]).toBe(section.path);
    }
  });

  it('does not assign the same path to multiple navigable center sections', () => {
    const paths = MODULE_ADMIN_SECTIONS.map((section) => section.path);

    expect(new Set(paths).size).toBe(paths.length);
  });
});
