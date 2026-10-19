export type ModuleAppEntitlementOperation =
  | 'install'
  | 'job'
  | 'launch'
  | 'run'
  | 'schedule'
  | 'visibility'
  | 'webhook';

export type ModuleAppProductType = 'free' | 'one_time' | 'subscription';
export type ModuleAppLicenseStatus = 'active' | 'expired' | 'revoked';
export type ModuleAppLicenseSource = 'purchase' | 'trial';

export type ModuleAppLicenseSnapshot = {
  endsAt?: Date | null;
  id: string;
  source: ModuleAppLicenseSource;
  startsAt?: Date | null;
  status: ModuleAppLicenseStatus;
};

export type ModuleAppEntitlementInput = {
  appStatus?: string;
  installation?: { active: boolean } | null;
  license?: ModuleAppLicenseSnapshot | null;
  now?: Date;
  operation: ModuleAppEntitlementOperation;
  planIncluded?: boolean;
  productType?: ModuleAppProductType;
  teamMembership?: { active: boolean } | null;
  workspaceScoped?: boolean;
};

export type ModuleAppEntitlementDecision =
  | { allowed: true; licenseId?: string; source: 'free' | 'plan' | 'purchase' | 'trial' }
  | {
      allowed: false;
      reason: 'hidden' | 'install_denied' | 'purchase_required' | 'license_expired' | 'suspended';
    };

const INSTALLATION_OPERATIONS = new Set<ModuleAppEntitlementOperation>([
  'job',
  'launch',
  'run',
  'schedule',
  'webhook',
]);

const isLicenseCurrentlyActive = (input: ModuleAppEntitlementInput) => {
  const license = input.license;
  if (!license || license.status !== 'active') return false;

  const now = input.now ?? new Date();
  if (license.startsAt && license.startsAt > now) return false;
  if (license.endsAt && license.endsAt <= now) return false;
  return true;
};

const requiresInstallation = (input: ModuleAppEntitlementInput) =>
  INSTALLATION_OPERATIONS.has(input.operation) &&
  input.installation !== undefined &&
  !input.installation?.active;

const requiresTeamMembership = (input: ModuleAppEntitlementInput) =>
  input.workspaceScoped === true &&
  input.teamMembership !== undefined &&
  !input.teamMembership?.active;

export const resolveModuleAppEntitlement = (
  input: ModuleAppEntitlementInput,
): ModuleAppEntitlementDecision => {
  if (input.appStatus !== undefined && input.appStatus !== 'published') {
    return { allowed: false, reason: 'suspended' };
  }

  if (input.license?.status === 'revoked') {
    return { allowed: false, reason: 'suspended' };
  }

  if (requiresTeamMembership(input)) {
    return { allowed: false, reason: 'install_denied' };
  }

  const licenseActive = isLicenseCurrentlyActive(input);
  const licenseExpired =
    input.license?.status === 'expired' ||
    (input.license?.status === 'active' && !licenseActive);

  if (licenseExpired && !input.planIncluded && input.productType !== 'free') {
    return { allowed: false, reason: 'license_expired' };
  }

  if (input.planIncluded) {
    if (requiresInstallation(input)) {
      return { allowed: false, reason: 'install_denied' };
    }

    return { allowed: true, source: 'plan' };
  }

  if (licenseActive && input.license) {
    if (requiresInstallation(input)) {
      return { allowed: false, reason: 'install_denied' };
    }

    return {
      allowed: true,
      licenseId: input.license.id,
      source: input.license.source,
    };
  }

  if (input.productType === 'free') {
    if (requiresInstallation(input)) {
      return { allowed: false, reason: 'install_denied' };
    }

    return { allowed: true, source: 'free' };
  }

  if (input.operation === 'visibility') {
    return { allowed: false, reason: 'hidden' };
  }

  if (input.productType === 'one_time' || input.productType === 'subscription') {
    return { allowed: false, reason: 'purchase_required' };
  }

  return { allowed: false, reason: 'install_denied' };
};

export class ModuleAppEntitlementError extends Error {
  readonly decision: Extract<ModuleAppEntitlementDecision, { allowed: false }>;
  readonly reason: Extract<ModuleAppEntitlementDecision, { allowed: false }>['reason'];

  constructor(decision: Extract<ModuleAppEntitlementDecision, { allowed: false }>) {
    super(`MODULE_APP_ENTITLEMENT_${decision.reason.toUpperCase()}`);
    this.name = 'ModuleAppEntitlementError';
    this.decision = decision;
    this.reason = decision.reason;
  }
}

export const assertModuleAppEntitlement = (
  input: ModuleAppEntitlementInput,
): Extract<ModuleAppEntitlementDecision, { allowed: true }> => {
  const decision = resolveModuleAppEntitlement(input);
  if (!decision.allowed) throw new ModuleAppEntitlementError(decision);
  return decision;
};
