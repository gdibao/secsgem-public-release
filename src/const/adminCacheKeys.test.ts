import { describe, expect, it } from 'vitest';

import {
  ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
  ADMIN_SETTINGS_SECTION_SWR_KEY,
  ADMIN_SETTINGS_SWR_KEY,
  getAdminSettingsWriteSWRKeys,
} from './adminCacheKeys';

describe('admin settings cache keys', () => {
  it('includes the section id in every page-scoped settings key', () => {
    expect(ADMIN_SETTINGS_SECTION_SWR_KEY('growth')).toEqual([
      'admin-settings',
      'section',
      'growth',
    ]);
    expect(ADMIN_SETTINGS_SECTION_SWR_KEY('notifications')).not.toEqual(
      ADMIN_SETTINGS_SECTION_SWR_KEY('growth'),
    );
  });

  it('invalidates only affected sections plus the compatibility aggregate', () => {
    expect(getAdminSettingsWriteSWRKeys(['growth', 'growth', 'notifications'])).toEqual([
      ADMIN_SETTINGS_SECTION_SWR_KEY('growth'),
      ADMIN_SETTINGS_SECTION_SWR_KEY('notifications'),
      ADMIN_SETTINGS_SWR_KEY,
    ]);
    expect(getAdminSettingsWriteSWRKeys(['growth'])).not.toContainEqual(
      ADMIN_SETTINGS_SECTION_SWR_KEY('operations'),
    );
  });

  it('invalidates desktop diagnostics when desktop settings change', () => {
    expect(getAdminSettingsWriteSWRKeys(['desktop-update'])).toEqual([
      ADMIN_SETTINGS_SECTION_SWR_KEY('desktop-update'),
      ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
      ADMIN_SETTINGS_SWR_KEY,
    ]);
  });
});
