// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirs: string[] = [];

const createStagedProfile = async (profile = {}) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'desktop-builder-profile-'));
  temporaryDirs.push(dir);
  const assets = {
    appPreview: path.join(dir, 'app-preview.png'),
    linuxIcon: path.join(dir, 'linux-icon.png'),
    macIcon: path.join(dir, 'mac-icon.icns'),
    nsisHeader: path.join(dir, 'nsis-header.bmp'),
    nsisSidebar: path.join(dir, 'nsis-sidebar.bmp'),
    windowsIcon: path.join(dir, 'windows-icon.ico'),
  };
  await mkdir(dir, { recursive: true });
  await Promise.all(Object.values(assets).map((file) => writeFile(file, 'asset')));
  const profilePath = path.join(dir, 'desktop-build-profile.json');
  await writeFile(
    profilePath,
    JSON.stringify({
      assets,
      profile: {
        applicationId: 'com.qingyouai.comhub',
        applicationName: 'ComHub',
        artifactName: 'ComHub-${version}-${arch}.${ext}',
        description: 'ComHub Desktop',
        deviceGatewayUrl: 'https://chat.qingyouai.com/device-gateway',
        executableName: 'ComHub',
        homepage: 'https://chat.qingyouai.com',
        installerArtifactName: '${productName}-${version}-setup.${ext}',
        officialCloudServer: 'https://chat.qingyouai.com',
        oidcClientId: 'lobehub-desktop',
        packageName: 'comhub-desktop',
        protocolScheme: 'comhub',
        publisher: 'Qingyou AI',
        shortcutName: 'ComHub',
        uninstallDisplayName: 'ComHub',
        ...profile,
      },
      profileRevisionId: '22222222-2222-4222-8222-222222222222',
      releaseId: '11111111-1111-4111-8111-111111111111',
    }),
  );
  return { assets, dir, profilePath };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe('desktop build profile', () => {
  it('maps a staged profile into Windows and NSIS config without mutating defaults', async () => {
    const { assets, profilePath } = await createStagedProfile();
    const realAssets = Object.fromEntries(
      await Promise.all(
        Object.entries(assets).map(async ([kind, file]) => [kind, await realpath(file)]),
      ),
    );
    const defaults = {
      appId: 'com.lobehub.lobehub-desktop',
      extraMetadata: { description: 'LobeHub', homepage: 'https://lobehub.com' },
      nsis: {
        artifactName: '${productName}-${version}-setup.${ext}',
        installerHeader: './build/nsis-header.bmp',
        installerSidebar: './build/nsis-sidebar.bmp',
        shortcutName: '${productName}',
        uninstallDisplayName: '${productName}',
        uninstallerSidebar: './build/nsis-sidebar.bmp',
      },
      officialCloudServer: 'https://chat.qingyouai.com',
      oidcClientId: 'lobehub-desktop',
      linux: { category: 'Utility', icon: './build/icon.png' },
      mac: {
        extendInfo: {
          CFBundleIconName: 'AppIcon',
          CFBundleURLTypes: [
            { CFBundleURLName: 'LobeHub Protocol', CFBundleURLSchemes: ['lobehub'] },
          ],
          NSCameraUsageDescription: 'camera',
        },
        icon: './build/Icon.icns',
      },
      productName: 'LobeHub',
      protocols: [{ name: 'LobeHub Protocol', schemes: ['lobehub'] }],
      win: { executableName: 'LobeHub' },
    };

    const { applyDesktopBuildProfile, loadDesktopBuildProfile } =
      await import('./desktop-build-profile.mjs');
    const result = applyDesktopBuildProfile(defaults, await loadDesktopBuildProfile(profilePath));

    expect(result).toMatchObject({
      appId: 'com.qingyouai.comhub',
      appImage: { artifactName: 'ComHub-${version}-${arch}.${ext}' },
      dmg: { artifactName: 'ComHub-${version}-${arch}.${ext}' },
      extraMetadata: {
        author: 'Qingyou AI',
        description: 'ComHub Desktop',
        homepage: 'https://chat.qingyouai.com',
        name: 'comhub-desktop',
      },
      nsis: {
        artifactName: '${productName}-${version}-setup.${ext}',
        installerHeader: realAssets.nsisHeader,
        installerSidebar: realAssets.nsisSidebar,
        shortcutName: 'ComHub',
        uninstallDisplayName: 'ComHub',
        uninstallerSidebar: realAssets.nsisSidebar,
      },
      linux: {
        artifactName: 'ComHub-${version}-${arch}.${ext}',
        category: 'Utility',
        icon: realAssets.linuxIcon,
      },
      mac: {
        artifactName: 'ComHub-${version}-${arch}.${ext}',
        extendInfo: { NSCameraUsageDescription: 'camera' },
        icon: realAssets.macIcon,
      },
      productName: 'ComHub',
      protocols: [{ name: 'ComHub Protocol', schemes: ['comhub'] }],
      win: { executableName: 'ComHub', icon: realAssets.windowsIcon },
    });
    expect(defaults.productName).toBe('LobeHub');
  });

  it('accepts profile-relative asset paths', async () => {
    const { dir, profilePath } = await createStagedProfile();
    const staged = JSON.parse(await readFile(profilePath, 'utf8'));
    staged.assets = Object.fromEntries(
      Object.entries(staged.assets).map(([kind, file]) => [kind, path.basename(file as string)]),
    );
    await writeFile(profilePath, JSON.stringify(staged));

    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');
    const loaded = await loadDesktopBuildProfile(profilePath);

    expect(loaded?.assets.windowsIcon).toBe(await realpath(path.join(dir, 'windows-icon.ico')));
    expect(loaded?.assets.macIcon).toBe(await realpath(path.join(dir, 'mac-icon.icns')));
  });

  it('uses defaults when no staged profile path is supplied', async () => {
    const defaults = { appId: 'com.lobehub.lobehub-desktop', win: { executableName: 'LobeHub' } };
    const { applyDesktopBuildProfile, loadDesktopBuildProfile } =
      await import('./desktop-build-profile.mjs');

    expect(applyDesktopBuildProfile(defaults, await loadDesktopBuildProfile(undefined))).toBe(
      defaults,
    );
  });

  it('fails closed when a staged asset path escapes the staging directory', async () => {
    const { profilePath } = await createStagedProfile({
      applicationName: 'ComHub',
    });
    const escaped = path.join(os.tmpdir(), 'escaped.ico');
    await writeFile(escaped, 'asset');
    temporaryDirs.push(escaped);
    const staged = JSON.parse(await readFile(profilePath, 'utf8'));
    staged.assets.windowsIcon = escaped;
    await writeFile(profilePath, JSON.stringify(staged));

    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_PATH_OUTSIDE_STAGING',
    );
  });

  it('fails closed when a staged asset symlink resolves outside the staging directory', async () => {
    const { dir, profilePath } = await createStagedProfile();
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'desktop-builder-outside-'));
    temporaryDirs.push(outsideDir);
    const outsideIcon = path.join(outsideDir, 'outside.ico');
    const linkPath = path.join(dir, 'linked.ico');
    await writeFile(outsideIcon, 'asset');
    await symlink(outsideIcon, linkPath, 'file');
    const staged = JSON.parse(await readFile(profilePath, 'utf8'));
    staged.assets.windowsIcon = linkPath;
    await writeFile(profilePath, JSON.stringify(staged));

    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_PATH_OUTSIDE_STAGING',
    );
  });

  it('fails closed when installer artifact names contain path separators', async () => {
    const { profilePath } = await createStagedProfile({
      installerArtifactName: '../${productName}-${version}-setup.${ext}',
    });
    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_INVALID',
    );
  });

  it('fails closed when package names or release artifact names are unsafe', async () => {
    const { profilePath } = await createStagedProfile({
      artifactName: '../ComHub-${version}.${ext}',
      packageName: '@invalid/package',
    });
    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_INVALID',
    );
  });

  it('fails closed when productName interpolation would inject path separators', async () => {
    const { profilePath } = await createStagedProfile({
      applicationName: '../ComHub',
    });
    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_INVALID',
    );
  });

  it('fails closed when the cloud server is not an HTTPS origin', async () => {
    const { profilePath } = await createStagedProfile({
      officialCloudServer: 'http://fab.secsgem.com.cn/path',
    });
    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_INVALID',
    );
  });

  it('fails closed when the OIDC client id is unsafe', async () => {
    const { profilePath } = await createStagedProfile({ oidcClientId: 'bad client id' });
    const { loadDesktopBuildProfile } = await import('./desktop-build-profile.mjs');

    await expect(loadDesktopBuildProfile(profilePath)).rejects.toThrow(
      'DESKTOP_BUILD_PROFILE_INVALID',
    );
  });
});
