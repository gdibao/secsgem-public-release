import { matchPath } from 'react-router';

import { ADMIN_BASE_PATH } from '@/features/Admin/adminCatalog';

export type ModuleAdminRouteId =
  | 'module-center-layout'
  | 'module-overview'
  | 'module-apps'
  | 'module-app-detail-layout'
  | 'module-app-overview'
  | 'module-app-configuration'
  | 'module-app-entitlements'
  | 'module-app-products'
  | 'module-app-runtime'
  | 'module-reviews'
  | 'module-publishers'
  | 'module-finance'
  | 'module-revenue'
  | 'module-payments'
  | 'module-payouts'
  | 'module-operations'
  | 'module-installs'
  | 'module-records'
  | 'module-runs'
  | 'module-artifacts'
  | 'module-audit';

export type ModuleAdminRouteNode = {
  children?: readonly ModuleAdminRouteNode[];
  id: ModuleAdminRouteId;
  index?: boolean;
  segment?: string;
};

export const MODULE_ADMIN_ROUTE_TREE: ModuleAdminRouteNode = {
  children: [
    { id: 'module-overview', index: true },
    { id: 'module-apps', segment: 'apps' },
    {
      children: [
        { id: 'module-app-overview', index: true },
        { id: 'module-app-configuration', segment: 'configuration' },
        { id: 'module-app-entitlements', segment: 'entitlements' },
        { id: 'module-app-products', segment: 'products' },
        { id: 'module-app-runtime', segment: 'runtime' },
      ],
      id: 'module-app-detail-layout',
      segment: 'apps/:appId',
    },
    { id: 'module-reviews', segment: 'reviews' },
    { id: 'module-publishers', segment: 'publishers' },
    {
      children: [
        { id: 'module-revenue', segment: 'revenue' },
        { id: 'module-payments', segment: 'payments' },
        { id: 'module-payouts', segment: 'payouts' },
      ],
      id: 'module-finance',
      segment: 'finance',
    },
    {
      children: [
        { id: 'module-installs', segment: 'installs' },
        { id: 'module-records', segment: 'records' },
        { id: 'module-runs', segment: 'runs' },
        { id: 'module-artifacts', segment: 'artifacts' },
      ],
      id: 'module-operations',
      segment: 'operations',
    },
    { id: 'module-audit', segment: 'audit' },
  ],
  id: 'module-center-layout',
  segment: 'modules',
};

const appendSegment = (parentPath: string, segment?: string) =>
  segment ? `${parentPath}/${segment}` : parentPath;

const buildModuleAdminRoutePaths = (
  node: ModuleAdminRouteNode,
  parentPath: string,
  paths: Partial<Record<ModuleAdminRouteId, string>>,
) => {
  const path = node.index ? parentPath : appendSegment(parentPath, node.segment);

  paths[node.id] = path;
  node.children?.forEach((child) => buildModuleAdminRoutePaths(child, path, paths));
};

const moduleAdminRoutePaths: Partial<Record<ModuleAdminRouteId, string>> = {};
buildModuleAdminRoutePaths(MODULE_ADMIN_ROUTE_TREE, ADMIN_BASE_PATH, moduleAdminRoutePaths);

export const MODULE_ADMIN_ROUTE_PATHS = moduleAdminRoutePaths as Record<ModuleAdminRouteId, string>;
export const MODULE_ADMIN_ROOT_PATH = MODULE_ADMIN_ROUTE_PATHS['module-center-layout'];

export type ModuleAdminSection = {
  id: ModuleAdminRouteId;
  label: string;
  path: string;
};

const createSection = (id: ModuleAdminRouteId, label: string): ModuleAdminSection => ({
  id,
  label,
  path: MODULE_ADMIN_ROUTE_PATHS[id],
});

export const MODULE_ADMIN_SECTIONS = [
  createSection('module-overview', 'Overview'),
  createSection('module-apps', 'Apps'),
  createSection('module-reviews', 'Reviews'),
  createSection('module-publishers', 'Publishers'),
  createSection('module-revenue', 'Revenue'),
  createSection('module-payments', 'Payments'),
  createSection('module-payouts', 'Payouts'),
  createSection('module-installs', 'Installs'),
  createSection('module-records', 'Records'),
  createSection('module-runs', 'Runs'),
  createSection('module-artifacts', 'Artifacts'),
  createSection('module-audit', 'Audit'),
] as const;

export const MODULE_APP_DETAIL_SECTIONS = [
  createSection('module-app-overview', 'Overview'),
  createSection('module-app-configuration', 'Configuration'),
  createSection('module-app-entitlements', 'Entitlements'),
  createSection('module-app-products', 'Products'),
  createSection('module-app-runtime', 'Runtime'),
] as const;

const sectionSpecificity = (section: ModuleAdminSection) =>
  section.path.split('/').reduce((score, segment) => score + (segment.startsWith(':') ? 1 : 2), 0);

const moduleAdminSectionsBySpecificity = [
  ...MODULE_ADMIN_SECTIONS,
  ...MODULE_APP_DETAIL_SECTIONS,
].sort(
  (left, right) =>
    sectionSpecificity(right) - sectionSpecificity(left) || right.path.length - left.path.length,
);

export const findModuleAdminSectionByPath = (pathname: string) =>
  moduleAdminSectionsBySpecificity.find((section) =>
    matchPath({ end: true, path: section.path }, pathname),
  );
