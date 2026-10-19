import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  hasAdminCapability,
  isAdminRole,
  isFullAdminRole,
} from '@lobechat/types';

import {
  MODULE_ADMIN_SECTIONS,
  MODULE_APP_DETAIL_SECTIONS,
  type ModuleAdminRouteId,
  type ModuleAdminSection,
} from './catalog';

export type AdminAccessPolicy = {
  allOf?: readonly AdminCapability[];
  anyOf?: readonly AdminCapability[];
};

export type ModuleAdminRoutePolicy = {
  access: AdminAccessPolicy;
  write?: AdminAccessPolicy;
};

const MODULE_APP_READ_POLICY = { allOf: [ADMIN_CAPABILITIES.moduleAppRead] } as const;
const FINANCE_READ_POLICY = { allOf: [ADMIN_CAPABILITIES.financeRead] } as const;
const PUBLISHER_READ_POLICY = {
  anyOf: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.financeRead],
} as const;

export const MODULE_ADMIN_ROUTE_POLICIES = {
  'module-center-layout': {
    access: { anyOf: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.financeRead] },
  },
  'module-overview': {
    access: { anyOf: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.financeRead] },
  },
  'module-apps': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-app-detail-layout': { access: MODULE_APP_READ_POLICY },
  'module-app-overview': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-app-configuration': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-app-entitlements': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.financeWrite] },
  },
  'module-app-products': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-app-runtime': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-reviews': {
    access: MODULE_APP_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-publishers': {
    access: PUBLISHER_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.moduleAppWrite] },
  },
  'module-finance': { access: FINANCE_READ_POLICY },
  'module-revenue': {
    access: FINANCE_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.financeWrite] },
  },
  'module-payments': {
    access: FINANCE_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.financeWrite] },
  },
  'module-payouts': {
    access: FINANCE_READ_POLICY,
    write: { allOf: [ADMIN_CAPABILITIES.financeWrite] },
  },
  'module-operations': { access: MODULE_APP_READ_POLICY },
  'module-installs': { access: MODULE_APP_READ_POLICY },
  'module-records': { access: MODULE_APP_READ_POLICY },
  'module-runs': { access: MODULE_APP_READ_POLICY },
  'module-artifacts': { access: MODULE_APP_READ_POLICY },
  'module-audit': {
    access: { anyOf: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.financeRead] },
  },
} as const satisfies Record<ModuleAdminRouteId, ModuleAdminRoutePolicy>;

export const canAccessAdminPolicy = (
  role: string | null | undefined,
  policy: AdminAccessPolicy,
) => {
  if (!isAdminRole(role)) return false;
  if (isFullAdminRole(role)) return true;

  const allAllowed = (policy.allOf ?? []).every((capability) =>
    hasAdminCapability(role, capability),
  );
  const anyAllowed =
    !policy.anyOf?.length ||
    policy.anyOf.some((capability) => hasAdminCapability(role, capability));

  return allAllowed && anyAllowed;
};

const getSectionsForRole = (
  role: string | null | undefined,
  sections: readonly ModuleAdminSection[],
) =>
  sections.filter((section) =>
    canAccessAdminPolicy(role, MODULE_ADMIN_ROUTE_POLICIES[section.id].access),
  );

export const getModuleCenterSectionsForRole = (role: string | null | undefined) =>
  getSectionsForRole(role, MODULE_ADMIN_SECTIONS);

export const getModuleAppSectionsForRole = (role: string | null | undefined) =>
  getSectionsForRole(role, MODULE_APP_DETAIL_SECTIONS);
