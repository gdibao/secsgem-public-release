import type { DesktopBuildAsset, DesktopBuildAssetKind } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildProfilePayloadFromForm,
  createDefaultBuildProfileForm,
  hasCompleteWindowsAssets,
  renderInstallerArtifactName,
} from './buildProfileForm';

const asset = (kind: DesktopBuildAssetKind): DesktopBuildAsset => ({
  contentType: kind === 'windowsIcon' ? 'image/x-icon' : 'image/png',
  key: `desktop-build-assets/profile/${kind}`,
  kind,
  sha256: kind.repeat(16).slice(0, 64).padEnd(64, 'a'),
  size: 1024,
});

describe('buildProfileForm', () => {
  it('creates a conservative default payload for a new desktop build profile', () => {
    const form = createDefaultBuildProfileForm();

    expect(buildProfilePayloadFromForm(form)).toEqual({
      applicationId: 'com.gdibao.chituoai',
      applicationName: '驰拓 AI 助手',
      description: '驰拓半导体私有化 AI 助手桌面客户端',
      executableName: 'ChituoAI',
      homepage: 'https://secsgem.com.cn',
      installerArtifactName: '${productName}-${version}-${arch}.${ext}',
      protocolScheme: 'chituoai',
      publisher: '无锡市驰拓信息科技有限公司',
      shortcutName: '驰拓 AI 助手',
      uninstallDisplayName: '驰拓 AI 助手',
    });
  });

  it('requires every Windows installer asset before release creation is enabled', () => {
    expect(
      hasCompleteWindowsAssets({
        appPreview: asset('appPreview'),
        nsisHeader: asset('nsisHeader'),
        nsisSidebar: asset('nsisSidebar'),
        windowsIcon: asset('windowsIcon'),
      }),
    ).toBe(true);
    expect(
      hasCompleteWindowsAssets({
        appPreview: asset('appPreview'),
        nsisHeader: asset('nsisHeader'),
        nsisSidebar: asset('nsisSidebar'),
      }),
    ).toBe(false);
  });

  it('renders the final installer artifact name with approved tokens only', () => {
    expect(
      renderInstallerArtifactName('${productName}-${version}-${arch}.${ext}', {
        arch: 'x64',
        ext: 'exe',
        productName: 'ComHub',
        version: '2.4.0',
      }),
    ).toBe('ComHub-2.4.0-x64.exe');
  });
});
