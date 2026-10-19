import { DOWNLOAD_URL } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { resolveDesktopDownloadEntry } from './resolveDesktopDownloadEntry';

describe('resolveDesktopDownloadEntry', () => {
  it('uses backend configured desktop download url and label when present', () => {
    const entry = resolveDesktopDownloadEntry({
      config: {
        currentVersion: '0.1.0-canary.6',
        downloadLabel: 'Download Qingyou Desktop',
        downloadUrl: 'https://comhubs.oss-cn-shanghai.aliyuncs.com/canary/app.exe',
        releaseNotes: '- Fix auto update',
      },
      fallbackLabel: 'getDesktopApp',
      isAndroid: true,
      isIOS: false,
    });

    expect(entry).toEqual({
      currentVersion: '0.1.0-canary.6',
      label: 'Download Qingyou Desktop',
      releaseNotes: '- Fix auto update',
      url: 'https://comhubs.oss-cn-shanghai.aliyuncs.com/canary/app.exe',
    });
  });

  it('falls back to platform download url and default label when backend config is empty', () => {
    expect(
      resolveDesktopDownloadEntry({
        config: {
          downloadLabel: '   ',
          downloadUrl: '',
        },
        fallbackLabel: 'getDesktopApp',
        isAndroid: false,
        isIOS: true,
      }),
    ).toEqual({
      currentVersion: null,
      label: 'getDesktopApp',
      releaseNotes: null,
      url: DOWNLOAD_URL.ios,
    });
  });
});
