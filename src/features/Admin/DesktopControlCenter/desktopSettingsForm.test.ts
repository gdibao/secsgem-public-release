import { describe, expect, it } from 'vitest';

import {
  buildBrandUpdates,
  buildDistributionUpdates,
  buildUpdateSettingsUpdates,
  getDesktopSettingsValues,
} from './desktopSettingsForm';

const settings = {
  desktopDownloadLabel: 'Download',
  desktopDownloadUrl: 'https://downloads.example.com/app.exe',
  desktopLoginConfig: { title: 'Sign in' },
  desktopOssConfig: { bucket: 'releases' },
  desktopUpdateConfig: {
    autoCheck: true,
    channel: 'stable',
    checkInterval: 60,
    currentVersion: '2.2.7',
    releaseNotes: 'Current notes',
    serverUrl: 'https://releases.example.com',
  },
} as any;

describe('desktop settings form ownership', () => {
  it('returns no updates for unchanged values', () => {
    const values = getDesktopSettingsValues(settings);
    expect(buildUpdateSettingsUpdates(values, values)).toEqual([]);
    expect(buildDistributionUpdates(values, values)).toEqual([]);
    expect(buildBrandUpdates(values, values)).toEqual([]);
  });

  it('limits update settings saves to update keys', () => {
    const initial = getDesktopSettingsValues(settings);
    expect(
      buildUpdateSettingsUpdates(initial, {
        ...initial,
        channel: 'canary',
        serverUrl: 'https://canary.example.com',
      }),
    ).toEqual([
      { key: 'desktop.update.serverUrl', value: 'https://canary.example.com' },
      { key: 'desktop.update.channel', value: 'canary' },
    ]);
  });

  it('does not write read-only OSS values', () => {
    const initial = getDesktopSettingsValues(settings);
    const updates = buildDistributionUpdates(initial, {
      ...initial,
      downloadLabel: 'Get desktop',
      ossBucket: 'malicious-change',
    });
    expect(updates).toEqual([{ key: 'desktop.download.label', value: 'Get desktop' }]);
  });
});
