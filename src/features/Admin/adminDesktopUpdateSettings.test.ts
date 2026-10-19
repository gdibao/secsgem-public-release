import { describe, expect, it } from 'vitest';

import {
  DESKTOP_DEFAULT_BUSINESS_SERVER_URL,
  DESKTOP_SETTINGS_SECTIONS,
  DESKTOP_UPDATE_SETTING_KEYS,
} from './adminDesktopUpdateSettings';

describe('adminDesktopUpdateSettings', () => {
  it('keeps desktop business connection separate from update and download settings', () => {
    expect(DESKTOP_DEFAULT_BUSINESS_SERVER_URL).toBe('https://fab.secsgem.com.cn');

    expect(DESKTOP_SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'overview',
      'distribution',
      'updates',
      'brand',
    ]);

    expect(DESKTOP_SETTINGS_SECTIONS[0]).toMatchObject({
      readonly: true,
      title: 'Overview',
    });
  });

  it('keeps update, download, and oss keys explicit for batch saves', () => {
    expect(DESKTOP_UPDATE_SETTING_KEYS.desktopUpdateServerUrl).toBe('desktop.update.serverUrl');
    expect(DESKTOP_UPDATE_SETTING_KEYS.desktopDownloadUrl).toBe('desktop.download.url');
    expect(DESKTOP_UPDATE_SETTING_KEYS.desktopLoginTitle).toBe('desktop.login.title');
    expect(DESKTOP_UPDATE_SETTING_KEYS.desktopLoginWindowTitle).toBe('desktop.login.windowTitle');
    expect(DESKTOP_UPDATE_SETTING_KEYS.desktopOssAccessKeySecret).toBe(
      'desktop.oss.accessKeySecret',
    );
  });
});
