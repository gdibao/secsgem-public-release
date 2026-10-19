export const ADMIN_CAPABILITIES = {
  adminAccess: 'admin.access',
  auditRead: 'audit.read',
  contentRead: 'content.read',
  contentWrite: 'content.write',
  financeRead: 'finance.read',
  financeWrite: 'finance.write',
  modelOpsRead: 'modelOps.read',
  modelOpsWrite: 'modelOps.write',
  moduleAppRead: 'moduleApp.read',
  moduleAppWrite: 'moduleApp.write',
  supportWrite: 'support.write',
  systemRead: 'system.read',
  systemWrite: 'system.write',
  userRead: 'user.read',
} as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[keyof typeof ADMIN_CAPABILITIES];

export type AdminCompactUser = {
  banned: boolean;
  createdAt: Date;
  id: string;
  lastActiveAt: Date | null;
  role: string | null;
};

export type AdminDependencyImpactItem = {
  code: string;
  count: number;
  details?: string[];
  title: string;
};

export type AdminDependencyImpact = {
  blocking: AdminDependencyImpactItem[];
  canProceed: boolean;
  immediateEffects: AdminDependencyImpactItem[];
  liveEffects: AdminDependencyImpactItem[];
  target: {
    id: string;
    label?: string;
    type: 'plan' | 'provider-instance' | 'provider-model';
  };
  targetExists: boolean;
};

export const ADMIN_ROLE_IDS = [
  'admin',
  'content_admin',
  'finance_admin',
  'model_ops',
  'module_admin',
  'support_admin',
  'system_admin',
] as const;

export type AdminRole = (typeof ADMIN_ROLE_IDS)[number];
export type AdminRoleCapabilitySet = readonly AdminCapability[] | '*';

export const ADMIN_ROLE_CAPABILITIES: Record<AdminRole, AdminRoleCapabilitySet> = {
  admin: '*',
  content_admin: [
    ADMIN_CAPABILITIES.contentRead,
    ADMIN_CAPABILITIES.contentWrite,
    ADMIN_CAPABILITIES.auditRead,
  ],
  finance_admin: [
    ADMIN_CAPABILITIES.financeRead,
    ADMIN_CAPABILITIES.financeWrite,
    ADMIN_CAPABILITIES.auditRead,
  ],
  model_ops: [
    ADMIN_CAPABILITIES.modelOpsRead,
    ADMIN_CAPABILITIES.modelOpsWrite,
    ADMIN_CAPABILITIES.auditRead,
  ],
  module_admin: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.moduleAppWrite],
  support_admin: [
    ADMIN_CAPABILITIES.supportWrite,
    ADMIN_CAPABILITIES.userRead,
    ADMIN_CAPABILITIES.auditRead,
  ],
  system_admin: [
    ADMIN_CAPABILITIES.systemRead,
    ADMIN_CAPABILITIES.systemWrite,
    ADMIN_CAPABILITIES.auditRead,
  ],
};

export const isAdminRole = (role?: string | null): role is AdminRole =>
  !!role && Object.hasOwn(ADMIN_ROLE_CAPABILITIES, role);

export const getAdminRoleCapabilitySet = (role?: string | null): AdminRoleCapabilitySet => {
  if (!isAdminRole(role)) return [];

  return ADMIN_ROLE_CAPABILITIES[role];
};

export const isFullAdminRole = (role?: string | null) => getAdminRoleCapabilitySet(role) === '*';

export const getAdminRoleCapabilities = (role?: string | null): AdminCapability[] => {
  const capabilitySet = getAdminRoleCapabilitySet(role);

  if (capabilitySet === '*') return Object.values(ADMIN_CAPABILITIES);

  return [...capabilitySet];
};

export const hasAdminCapability = (
  role: string | null | undefined,
  capability: AdminCapability,
) => {
  const capabilitySet = getAdminRoleCapabilitySet(role);

  return capabilitySet === '*' || capabilitySet.includes(capability);
};
