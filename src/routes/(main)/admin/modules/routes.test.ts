import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MODULE_ADMIN_ROUTE_IMPORTS } from '@/business/client/moduleAdminRouteImports';
import {
  MODULE_ADMIN_ROUTE_TREE,
  type ModuleAdminRouteId,
  type ModuleAdminRouteNode,
} from '@/features/Admin/moduleApps/navigation/catalog';

const routeFiles: Partial<Record<ModuleAdminRouteId, string>> = {
  'module-app-configuration':
    'src/routes/(main)/admin/modules/apps/[appId]/configuration/index.tsx',
  'module-app-detail-layout': 'src/routes/(main)/admin/modules/apps/[appId]/_layout/index.tsx',
  'module-app-entitlements': 'src/routes/(main)/admin/modules/apps/[appId]/entitlements/index.tsx',
  'module-app-overview': 'src/routes/(main)/admin/modules/apps/[appId]/index.tsx',
  'module-app-products': 'src/routes/(main)/admin/modules/apps/[appId]/products/index.tsx',
  'module-app-runtime': 'src/routes/(main)/admin/modules/apps/[appId]/runtime/index.tsx',
  'module-apps': 'src/routes/(main)/admin/modules/apps/index.tsx',
  'module-artifacts': 'src/routes/(main)/admin/modules/operations/artifacts/index.tsx',
  'module-audit': 'src/routes/(main)/admin/modules/audit/index.tsx',
  'module-center-layout': 'src/routes/(main)/admin/modules/_layout/index.tsx',
  'module-installs': 'src/routes/(main)/admin/modules/operations/installs/index.tsx',
  'module-overview': 'src/routes/(main)/admin/modules/index.tsx',
  'module-payments': 'src/routes/(main)/admin/modules/finance/payments/index.tsx',
  'module-payouts': 'src/routes/(main)/admin/modules/finance/payouts/index.tsx',
  'module-publishers': 'src/routes/(main)/admin/modules/publishers/index.tsx',
  'module-records': 'src/routes/(main)/admin/modules/operations/records/index.tsx',
  'module-revenue': 'src/routes/(main)/admin/modules/finance/revenue/index.tsx',
  'module-reviews': 'src/routes/(main)/admin/modules/reviews/index.tsx',
  'module-runs': 'src/routes/(main)/admin/modules/operations/runs/index.tsx',
};

const flattenRouteIds = (node: ModuleAdminRouteNode): ModuleAdminRouteId[] => [
  node.id,
  ...(node.children?.flatMap(flattenRouteIds) ?? []),
];

describe('Module Center thin route modules', () => {
  it('defines one import-map entry for every route ID', () => {
    const routeIds = flattenRouteIds(MODULE_ADMIN_ROUTE_TREE);

    expect(Object.keys(MODULE_ADMIN_ROUTE_IMPORTS).sort()).toEqual([...routeIds].sort());
    expect(MODULE_ADMIN_ROUTE_IMPORTS['module-finance']).toBeUndefined();
    expect(MODULE_ADMIN_ROUTE_IMPORTS['module-operations']).toBeUndefined();
    expect(Object.keys(routeFiles).sort()).toEqual(
      routeIds.filter((id) => !['module-finance', 'module-operations'].includes(id)).sort(),
    );
  });

  it('keeps every routed page as a thin feature export', () => {
    for (const [routeId, relativePath] of Object.entries(routeFiles)) {
      const absolutePath = path.resolve(process.cwd(), relativePath);
      expect(existsSync(absolutePath), `${routeId} route file is missing`).toBe(true);

      const source = readFileSync(absolutePath, 'utf8');
      expect(source, `${routeId} must import a moduleApps feature`).toMatch(
        /from '@\/features\/Admin\/moduleApps\//,
      );
      expect(source, `${routeId} must remain a default-export-only route root`).toMatch(
        /^import [^\n]+ from '@\/features\/Admin\/moduleApps\/[^']+';\r?\n\r?\nexport default [^;]+;\r?\n$/,
      );
      expect(source).not.toMatch(/@\/libs\/swr|@\/services|@\/store|from 'antd'/);
    }
  });
});
