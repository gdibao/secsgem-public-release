import type { ComponentType } from 'react';

import type { ModuleAdminRouteId } from '@/features/Admin/moduleApps/navigation/catalog';

type ImportPage = () => Promise<{ default: ComponentType } | ComponentType>;

export const MODULE_ADMIN_ROUTE_IMPORTS: Record<ModuleAdminRouteId, ImportPage | undefined> = {
  'module-app-configuration': () =>
    import('@/routes/(main)/admin/modules/apps/[appId]/configuration'),
  'module-app-detail-layout': () => import('@/routes/(main)/admin/modules/apps/[appId]/_layout'),
  'module-app-entitlements': () =>
    import('@/routes/(main)/admin/modules/apps/[appId]/entitlements'),
  'module-app-overview': () => import('@/routes/(main)/admin/modules/apps/[appId]'),
  'module-app-products': () => import('@/routes/(main)/admin/modules/apps/[appId]/products'),
  'module-app-runtime': () => import('@/routes/(main)/admin/modules/apps/[appId]/runtime'),
  'module-apps': () => import('@/routes/(main)/admin/modules/apps'),
  'module-artifacts': () => import('@/routes/(main)/admin/modules/operations/artifacts'),
  'module-audit': () => import('@/routes/(main)/admin/modules/audit'),
  'module-center-layout': () => import('@/routes/(main)/admin/modules/_layout'),
  'module-finance': undefined,
  'module-installs': () => import('@/routes/(main)/admin/modules/operations/installs'),
  'module-operations': undefined,
  'module-overview': () => import('@/routes/(main)/admin/modules'),
  'module-payments': () => import('@/routes/(main)/admin/modules/finance/payments'),
  'module-payouts': () => import('@/routes/(main)/admin/modules/finance/payouts'),
  'module-publishers': () => import('@/routes/(main)/admin/modules/publishers'),
  'module-records': () => import('@/routes/(main)/admin/modules/operations/records'),
  'module-revenue': () => import('@/routes/(main)/admin/modules/finance/revenue'),
  'module-reviews': () => import('@/routes/(main)/admin/modules/reviews'),
  'module-runs': () => import('@/routes/(main)/admin/modules/operations/runs'),
};
