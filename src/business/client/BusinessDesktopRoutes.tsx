import { type RouteObject } from 'react-router';

import { dynamicElement, dynamicLayout, ErrorBoundary } from '@/utils/router';

import {
  ADMIN_SETTINGS_ROUTE_REGISTRY,
  type AdminSettingsRouteRegistryItem,
} from './adminSettingsRouteRegistry';

export const buildAdminSettingsRouteObject = (
  node: AdminSettingsRouteRegistryItem,
): RouteObject => {
  const hasChildren = Boolean(node.children?.length);
  const element = node.importPage
    ? hasChildren
      ? dynamicLayout(node.importPage, node.debugId)
      : dynamicElement(node.importPage, node.debugId)
    : undefined;

  if (node.index) {
    return {
      ...(element ? { element } : {}),
      index: true,
    };
  }

  return {
    ...(node.children ? { children: node.children.map(buildAdminSettingsRouteObject) } : {}),
    ...(element ? { element } : {}),
    path: node.segment,
  };
};

const settingsAdminRoute: RouteObject = {
  children: ADMIN_SETTINGS_ROUTE_REGISTRY.map(buildAdminSettingsRouteObject),
  element: dynamicLayout(() => import('@/routes/(main)/admin/_layout'), 'Desktop > Admin > Layout'),
  errorElement: <ErrorBoundary />,
  path: 'admin',
};

export const BusinessDesktopRoutesWithMainLayout: RouteObject[] = [
  {
    element: dynamicElement(() => import('@/routes/(main)/topup'), 'Desktop > TopUp'),
    path: 'topup',
  },
];
export const BusinessDesktopRoutesWithSettingsLayout: RouteObject[] = [settingsAdminRoute];
export const BusinessDesktopRoutesWithoutMainLayout: RouteObject[] = [];
export const BusinessResourceRoutes: RouteObject[] = [];
