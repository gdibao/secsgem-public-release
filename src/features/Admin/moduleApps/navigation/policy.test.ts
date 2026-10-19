import { ADMIN_CAPABILITIES } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  canAccessAdminPolicy,
  getModuleAppSectionsForRole,
  getModuleCenterSectionsForRole,
} from './policy';

describe('module admin navigation policies', () => {
  it('shows finance administrators only their accessible center sections', () => {
    expect(getModuleCenterSectionsForRole('finance_admin').map((item) => item.id)).toEqual([
      'module-overview',
      'module-publishers',
      'module-revenue',
      'module-payments',
      'module-payouts',
      'module-audit',
    ]);
  });

  it('does not grant finance administrators module application access', () => {
    expect(
      canAccessAdminPolicy('finance_admin', { allOf: [ADMIN_CAPABILITIES.moduleAppRead] }),
    ).toBe(false);
  });

  it('filters app detail sections using module application read access', () => {
    expect(getModuleAppSectionsForRole('finance_admin')).toEqual([]);
  });

  it('delegates governance and publisher review without finance access', () => {
    expect(getModuleCenterSectionsForRole('module_admin').map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'module-apps',
        'module-publishers',
        'module-reviews',
        'module-installs',
        'module-records',
        'module-runs',
        'module-artifacts',
        'module-audit',
      ]),
    );
    expect(getModuleCenterSectionsForRole('module_admin').map((item) => item.id)).not.toContain(
      'module-payments',
    );
    expect(getModuleAppSectionsForRole('module_admin').length).toBeGreaterThan(0);
  });
});
