import { type AdminRole, hasAdminCapability, isAdminRole, isFullAdminRole } from '@lobechat/types';

import {
  ADMIN_BASE_PATH,
  ADMIN_CATALOG,
  ADMIN_CATALOG_GROUPS,
  type AdminCatalogItem,
  type AdminFeatureStatus,
  type AdminNavGroupKey,
  type AdminNavIcon,
  getAdminCatalogAccessCapabilities,
} from './adminCatalog';
import {
  findModuleAdminSectionByPath,
  MODULE_ADMIN_ROOT_PATH,
} from './moduleApps/navigation/catalog';
import {
  canAccessAdminPolicy,
  getModuleCenterSectionsForRole,
  MODULE_ADMIN_ROUTE_POLICIES,
} from './moduleApps/navigation/policy';

export { ADMIN_BASE_PATH, type AdminNavGroupKey, type AdminNavIcon } from './adminCatalog';

export type AdminNavItem = {
  description: string;
  icon: AdminNavIcon;
  id: string;
  label: string;
  path: string;
  status: AdminFeatureStatus;
};

export type AdminNavGroup = {
  description: string;
  icon: AdminNavIcon;
  items: AdminNavItem[];
  key: AdminNavGroupKey;
  label: string;
};

const isVisibleInNavigation = (item: AdminCatalogItem) =>
  item.status !== 'planned' && item.status !== 'compatibility';

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = ADMIN_CATALOG_GROUPS.map((group) => ({
  ...group,
  items: ADMIN_CATALOG.filter(
    (item) => item.group === group.key && isVisibleInNavigation(item),
  ).map((item) => ({
    description: item.description,
    icon: item.icon,
    id: item.id,
    label: item.label,
    path: item.path,
    status: item.status,
  })),
}));

const ADMIN_PATH_CAPABILITIES = new Map(
  ADMIN_CATALOG.map((item) => [item.path, getAdminCatalogAccessCapabilities(item)] as const),
);

const ADMIN_ROLE_DEFAULT_PATHS: Record<AdminRole, string> = {
  admin: ADMIN_BASE_PATH,
  content_admin: `${ADMIN_BASE_PATH}/content-resources`,
  finance_admin: `${ADMIN_BASE_PATH}/subscriptions`,
  model_ops: `${ADMIN_BASE_PATH}/providers`,
  module_admin: `${ADMIN_BASE_PATH}/modules`,
  support_admin: `${ADMIN_BASE_PATH}/users`,
  system_admin: `${ADMIN_BASE_PATH}/settings`,
};

export const normalizeAdminPath = (pathname: string) => {
  const cleanPath = pathname.replace(/\/+$/, '') || ADMIN_BASE_PATH;

  if (cleanPath === '/admin') return ADMIN_BASE_PATH;
  if (cleanPath.startsWith('/admin/'))
    return `${ADMIN_BASE_PATH}${cleanPath.slice('/admin'.length)}`;

  return cleanPath;
};

export const canAccessAdminPath = (role: string | null | undefined, pathname: string) => {
  if (!isAdminRole(role)) return false;
  if (isFullAdminRole(role)) return true;

  const cleanPath = normalizeAdminPath(pathname);
  const moduleSection = findModuleAdminSectionByPath(cleanPath);
  if (moduleSection) {
    return canAccessAdminPolicy(role, MODULE_ADMIN_ROUTE_POLICIES[moduleSection.id].access);
  }

  const selectedPath = getAdminSelectedKey(pathname);
  const capabilities = ADMIN_PATH_CAPABILITIES.get(selectedPath);

  return !!capabilities && capabilities.some((capability) => hasAdminCapability(role, capability));
};

export const getAdminDefaultPath = (role: string | null | undefined) => {
  if (!isAdminRole(role)) return '/';

  return ADMIN_ROLE_DEFAULT_PATHS[role];
};

export const getAdminUnauthorizedFallbackPath = (
  role: string | null | undefined,
  pathname: string,
) => {
  const cleanPath = normalizeAdminPath(pathname);
  if (cleanPath === MODULE_ADMIN_ROOT_PATH || cleanPath.startsWith(`${MODULE_ADMIN_ROOT_PATH}/`)) {
    return getModuleCenterSectionsForRole(role)[0]?.path ?? getAdminDefaultPath(role);
  }

  return getAdminDefaultPath(role);
};

export const getAdminNavGroupsForRole = (role: string | null | undefined): AdminNavGroup[] =>
  ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessAdminPath(role, item.path)),
  })).filter((group) => group.items.length > 0);

const allAdminItems = ADMIN_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupKey: group.key })),
).sort((a, b) => b.path.length - a.path.length);

export const getAdminSelectedKey = (pathname: string) => {
  const cleanPath = normalizeAdminPath(pathname);
  return (
    allAdminItems.find((item) => cleanPath === item.path || cleanPath.startsWith(`${item.path}/`))
      ?.path ?? ADMIN_BASE_PATH
  );
};

export const getAdminOpenKeys = (pathname: string): AdminNavGroupKey[] => {
  const selectedKey = getAdminSelectedKey(pathname);
  const group = allAdminItems.find((item) => item.path === selectedKey)?.groupKey;

  return group ? [group] : ['overview'];
};

export const getAdminNavigationContext = (role: string | null | undefined, pathname: string) => {
  const groups = getAdminNavGroupsForRole(role);
  const selectedKey = getAdminSelectedKey(pathname);

  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.path === selectedKey);
    if (item) return { group, item };
  }

  return null;
};

export const filterAdminNavGroups = (groups: AdminNavGroup[], query: string): AdminNavGroup[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return groups;

  return groups.flatMap((group) => {
    const groupMatches = `${group.label} ${group.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
    const items = groupMatches
      ? group.items
      : group.items.filter((item) =>
          `${item.label} ${item.description}`.toLocaleLowerCase().includes(normalizedQuery),
        );

    return items.length > 0 ? [{ ...group, items }] : [];
  });
};
