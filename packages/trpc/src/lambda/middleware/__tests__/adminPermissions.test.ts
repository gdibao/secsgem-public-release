import { describe, expect, it } from 'vitest';

import {
  ADMIN_CAPABILITIES,
  getAdminRoleCapabilities,
  hasAdminCapability,
  isFullAdminRole,
} from '../adminPermissions';

describe('adminPermissions', () => {
  it('keeps the existing admin role as full-access for backward compatibility', () => {
    expect(isFullAdminRole('admin')).toBe(true);

    for (const capability of Object.values(ADMIN_CAPABILITIES)) {
      expect(hasAdminCapability('admin', capability)).toBe(true);
    }
  });

  it('does not grant admin access to ordinary or unknown roles by default', () => {
    expect(hasAdminCapability('user', ADMIN_CAPABILITIES.adminAccess)).toBe(false);
    expect(hasAdminCapability(null, ADMIN_CAPABILITIES.adminAccess)).toBe(false);
    expect(hasAdminCapability(undefined, ADMIN_CAPABILITIES.adminAccess)).toBe(false);
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.adminAccess)).toBe(false);
  });

  it('defines future scoped roles without making them super admins', () => {
    expect(isFullAdminRole('finance_admin')).toBe(false);
    expect(getAdminRoleCapabilities('finance_admin')).toEqual(
      expect.arrayContaining([
        ADMIN_CAPABILITIES.financeRead,
        ADMIN_CAPABILITIES.financeWrite,
      ]),
    );
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.contentWrite)).toBe(false);
  });
});
