import { describe, expect, it } from 'vitest';

import {
  assertModuleAppEntitlement,
  ModuleAppEntitlementError,
  resolveModuleAppEntitlement,
} from './entitlement';

const activeInstallation = { active: true };

describe('resolveModuleAppEntitlement', () => {
  it('allows an operation included by the current plan', () => {
    expect(
      resolveModuleAppEntitlement({
        operation: 'run',
        planIncluded: true,
      }),
    ).toEqual({ allowed: true, source: 'plan' });
  });

  it('requires a purchase for a paid application without a license', () => {
    expect(
      resolveModuleAppEntitlement({
        installation: activeInstallation,
        license: null,
        operation: 'run',
        planIncluded: false,
        productType: 'one_time',
      }),
    ).toEqual({ allowed: false, reason: 'purchase_required' });
  });

  it('rejects an expired license for background jobs', () => {
    expect(
      resolveModuleAppEntitlement({
        installation: activeInstallation,
        license: {
          endsAt: new Date('2026-07-10T00:00:00.000Z'),
          id: 'license-1',
          source: 'purchase',
          status: 'active',
        },
        now: new Date('2026-07-11T00:00:00.000Z'),
        operation: 'job',
        planIncluded: false,
        productType: 'subscription',
      }),
    ).toEqual({ allowed: false, reason: 'license_expired' });
  });

  it('allows an active trial and returns its license identity', () => {
    expect(
      resolveModuleAppEntitlement({
        installation: activeInstallation,
        license: {
          endsAt: new Date('2026-07-20T00:00:00.000Z'),
          id: 'trial-1',
          source: 'trial',
          startsAt: new Date('2026-07-01T00:00:00.000Z'),
          status: 'active',
        },
        now: new Date('2026-07-11T00:00:00.000Z'),
        operation: 'run',
        planIncluded: false,
        productType: 'subscription',
      }),
    ).toEqual({ allowed: true, licenseId: 'trial-1', source: 'trial' });
  });

  it('rejects revoked licenses and unpublished applications as suspended', () => {
    expect(
      resolveModuleAppEntitlement({
        installation: activeInstallation,
        license: { id: 'license-1', source: 'purchase', status: 'revoked' },
        operation: 'run',
        planIncluded: false,
        productType: 'one_time',
      }),
    ).toEqual({ allowed: false, reason: 'suspended' });

    expect(
      resolveModuleAppEntitlement({
        appStatus: 'unpublished',
        operation: 'visibility',
        planIncluded: true,
      }),
    ).toEqual({ allowed: false, reason: 'suspended' });
  });

  it('distinguishes hidden, install-denied, and missing-installation decisions', () => {
    expect(
      resolveModuleAppEntitlement({ operation: 'visibility', planIncluded: false }),
    ).toEqual({ allowed: false, reason: 'hidden' });
    expect(resolveModuleAppEntitlement({ operation: 'install', planIncluded: false })).toEqual({
      allowed: false,
      reason: 'install_denied',
    });
    expect(
      resolveModuleAppEntitlement({
        installation: { active: false },
        operation: 'run',
        planIncluded: true,
      }),
    ).toEqual({ allowed: false, reason: 'install_denied' });
  });

  it('requires active team membership for workspace operations', () => {
    expect(
      resolveModuleAppEntitlement({
        installation: activeInstallation,
        operation: 'job',
        planIncluded: true,
        teamMembership: { active: false },
        workspaceScoped: true,
      }),
    ).toEqual({ allowed: false, reason: 'install_denied' });
  });

  it('throws a typed error for denied decisions', () => {
    expect(() =>
      assertModuleAppEntitlement({ operation: 'visibility', planIncluded: false }),
    ).toThrow(ModuleAppEntitlementError);
    expect(() =>
      assertModuleAppEntitlement({ operation: 'visibility', planIncluded: false }),
    ).toThrow('MODULE_APP_ENTITLEMENT_HIDDEN');
  });
});
