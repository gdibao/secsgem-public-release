import { describe, expect, it } from 'vitest';

import { SETTING_KEYS } from './adminSettingsForm';
import {
  buildInitialValues,
  buildNotificationMaterializationUpdates,
} from './AdminNotificationsPage';

describe('AdminNotificationsPage settings helpers', () => {
  it('materializes notification defaults for system announcement settings', () => {
    const values = buildInitialValues({});

    expect(buildNotificationMaterializationUpdates(values)).toEqual(
      expect.arrayContaining([
        { key: SETTING_KEYS.notificationInboxEnabled, value: true },
        { key: SETTING_KEYS.notificationDesktopEnabled, value: true },
        { key: SETTING_KEYS.notificationEmailEnabled, value: false },
        { key: SETTING_KEYS.notificationPushEnabled, value: true },
        { key: SETTING_KEYS.notificationRetentionDays, value: 90 },
        { key: SETTING_KEYS.notificationSystemEnabled, value: false },
        { key: SETTING_KEYS.notificationSystemTitle, value: '' },
        { key: SETTING_KEYS.notificationSystemContent, value: '' },
        { key: SETTING_KEYS.notificationSystemActionLabel, value: '' },
        { key: SETTING_KEYS.notificationSystemActionUrl, value: '' },
        { key: SETTING_KEYS.notificationSystemType, value: 'warning' },
      ]),
    );
  });
});
