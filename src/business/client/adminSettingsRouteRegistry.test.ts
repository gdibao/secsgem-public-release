import { describe, expect, it } from 'vitest';

import { MODULE_ADMIN_ROUTE_IMPORTS } from '@/business/client/moduleAdminRouteImports';
import {
  MODULE_ADMIN_ROUTE_TREE,
  type ModuleAdminRouteNode,
} from '@/features/Admin/moduleApps/navigation/catalog';

import {
  ADMIN_SETTINGS_ROUTE_REGISTRY,
  ADMIN_SETTINGS_ROUTE_SEGMENTS,
  type AdminSettingsRouteRegistryItem,
} from './adminSettingsRouteRegistry';

describe('adminSettingsRouteRegistry', () => {
  it('registers the pilot workspace management page', () => {
    expect(ADMIN_SETTINGS_ROUTE_REGISTRY.find((route) => route.id === 'workspaces')).toMatchObject({
      segment: 'workspaces',
      status: 'active',
    });
  });

  it('registers the mobile admin settings route segment', () => {
    expect(ADMIN_SETTINGS_ROUTE_SEGMENTS).toContain('mobile');
  });

  it('keeps the overview as the registry index route', () => {
    expect(ADMIN_SETTINGS_ROUTE_REGISTRY.find((route) => route.id === 'overview')).toMatchObject({
      index: true,
    });
  });

  it('registers the Module Center tree and removes the old monolith segment', () => {
    const modules = ADMIN_SETTINGS_ROUTE_REGISTRY.find(
      (route) => route.id === 'module-center-layout',
    );

    expect(ADMIN_SETTINGS_ROUTE_SEGMENTS).toContain('modules');
    expect(ADMIN_SETTINGS_ROUTE_SEGMENTS).not.toContain('module-apps');
    expect(modules?.children?.map((route) => route.id)).toEqual(
      MODULE_ADMIN_ROUTE_TREE.children?.map((route) => route.id),
    );
    expect(modules?.importPage).toBe(MODULE_ADMIN_ROUTE_IMPORTS['module-center-layout']);
  });

  it('keeps finance and operations grouping nodes layout-only', () => {
    const modules = ADMIN_SETTINGS_ROUTE_REGISTRY.find(
      (route) => route.id === 'module-center-layout',
    );

    expect(modules).toBeDefined();
    const children = modules!.children ?? [];
    const finance = children.find((route) => route.id === 'module-finance');
    const operations = children.find((route) => route.id === 'module-operations');

    expect(finance).toBeDefined();
    expect(finance?.segment).toBe('finance');
    expect(finance?.importPage).toBeUndefined();
    expect(operations).toBeDefined();
    expect(operations?.segment).toBe('operations');
    expect(operations?.importPage).toBeUndefined();
  });

  it('maps every recursive Module Center node to its exact importer', () => {
    const modules = ADMIN_SETTINGS_ROUTE_REGISTRY.find(
      (route) => route.id === 'module-center-layout',
    );
    const registryById = new Map<string, AdminSettingsRouteRegistryItem>();
    const collectRegistry = (route: AdminSettingsRouteRegistryItem) => {
      registryById.set(route.id, route);
      route.children?.forEach(collectRegistry);
    };
    const collectMetadata = (node: ModuleAdminRouteNode): ModuleAdminRouteNode[] => [
      node,
      ...(node.children?.flatMap(collectMetadata) ?? []),
    ];

    expect(modules).toBeDefined();
    collectRegistry(modules!);

    for (const node of collectMetadata(MODULE_ADMIN_ROUTE_TREE)) {
      expect(registryById.get(node.id)?.importPage).toBe(MODULE_ADMIN_ROUTE_IMPORTS[node.id]);
    }
  });
});
