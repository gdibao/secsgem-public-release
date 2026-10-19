// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertModuleAppPackageAppOwnership } from '../moduleAppCatalog';

describe('assertModuleAppPackageAppOwnership', () => {
  it('allows a new app or an app owned by the submitting publisher', () => {
    expect(() => assertModuleAppPackageAppOwnership(undefined, 'publisher-1')).not.toThrow();
    expect(() =>
      assertModuleAppPackageAppOwnership({ publisherId: 'publisher-1' }, 'publisher-1'),
    ).not.toThrow();
  });

  it('rejects another publisher and unowned legacy slugs', () => {
    expect(() =>
      assertModuleAppPackageAppOwnership({ publisherId: 'publisher-2' }, 'publisher-1'),
    ).toThrow('MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH');
    expect(() => assertModuleAppPackageAppOwnership({ publisherId: null }, 'publisher-1')).toThrow(
      'MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH',
    );
  });
});
