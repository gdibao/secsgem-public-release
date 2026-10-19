import { describe, expect, it } from 'vitest';

import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLE_IDS,
  getAdminRoleCapabilities,
  hasAdminCapability,
  isAdminRole,
  isFullAdminRole,
} from './admin';

describe('shared admin roles', () => {
  it('publishes every assignable full and scoped admin role', () => {
    expect(ADMIN_ROLE_IDS).toEqual([
      'admin',
      'content_admin',
      'finance_admin',
      'model_ops',
      'module_admin',
      'support_admin',
      'system_admin',
    ]);

    for (const role of ADMIN_ROLE_IDS) expect(isAdminRole(role)).toBe(true);
    expect(isAdminRole('user')).toBe(false);
  });

  it('keeps scoped roles limited to their declared capabilities', () => {
    expect(isFullAdminRole('admin')).toBe(true);
    expect(isFullAdminRole('finance_admin')).toBe(false);
    expect(getAdminRoleCapabilities('finance_admin')).toEqual(
      expect.arrayContaining([
        ADMIN_CAPABILITIES.auditRead,
        ADMIN_CAPABILITIES.financeRead,
        ADMIN_CAPABILITIES.financeWrite,
      ]),
    );
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.systemWrite)).toBe(false);
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.adminAccess)).toBe(false);
  });

  it('publishes active capabilities without retired unused aliases', () => {
    expect(ADMIN_CAPABILITIES).toMatchObject({
      contentRead: 'content.read',
      contentWrite: 'content.write',
      modelOpsRead: 'modelOps.read',
      modelOpsWrite: 'modelOps.write',
      moduleAppRead: 'moduleApp.read',
      moduleAppWrite: 'moduleApp.write',
      supportWrite: 'support.write',
      systemRead: 'system.read',
      systemWrite: 'system.write',
      userRead: 'user.read',
    });
    expect(ADMIN_CAPABILITIES).not.toHaveProperty('supportRead');
    expect(ADMIN_CAPABILITIES).not.toHaveProperty('userWrite');
  });

  it('grants scoped roles their read capability without cross-domain access', () => {
    expect(getAdminRoleCapabilities('content_admin')).toEqual(
      expect.arrayContaining([
        ADMIN_CAPABILITIES.auditRead,
        ADMIN_CAPABILITIES.contentRead,
        ADMIN_CAPABILITIES.contentWrite,
      ]),
    );
    expect(getAdminRoleCapabilities('model_ops')).toEqual(
      expect.arrayContaining([
        ADMIN_CAPABILITIES.auditRead,
        ADMIN_CAPABILITIES.modelOpsRead,
        ADMIN_CAPABILITIES.modelOpsWrite,
      ]),
    );
    expect(getAdminRoleCapabilities('module_admin')).toEqual(
      expect.arrayContaining([ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.moduleAppWrite]),
    );
    expect(getAdminRoleCapabilities('support_admin')).toEqual([
      ADMIN_CAPABILITIES.supportWrite,
      ADMIN_CAPABILITIES.userRead,
      ADMIN_CAPABILITIES.auditRead,
    ]);
    expect(getAdminRoleCapabilities('system_admin')).toEqual(
      expect.arrayContaining([
        ADMIN_CAPABILITIES.auditRead,
        ADMIN_CAPABILITIES.systemRead,
        ADMIN_CAPABILITIES.systemWrite,
      ]),
    );
    expect(hasAdminCapability('content_admin', ADMIN_CAPABILITIES.moduleAppWrite)).toBe(false);
    expect(hasAdminCapability('support_admin', ADMIN_CAPABILITIES.financeWrite)).toBe(false);
  });

  it('keeps Module App governance ownership separate from finance administration', () => {
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.financeRead)).toBe(true);
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.moduleAppRead)).toBe(false);
    expect(hasAdminCapability('finance_admin', ADMIN_CAPABILITIES.moduleAppWrite)).toBe(false);

    for (const role of ADMIN_ROLE_IDS.filter(
      (role) => role !== 'admin' && role !== 'module_admin',
    )) {
      expect(hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppRead)).toBe(false);
      expect(hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite)).toBe(false);
    }
    expect(hasAdminCapability('module_admin', ADMIN_CAPABILITIES.moduleAppRead)).toBe(true);
    expect(hasAdminCapability('module_admin', ADMIN_CAPABILITIES.moduleAppWrite)).toBe(true);
    expect(hasAdminCapability('module_admin', ADMIN_CAPABILITIES.auditRead)).toBe(false);
    expect(hasAdminCapability('module_admin', ADMIN_CAPABILITIES.financeRead)).toBe(false);
  });
});
