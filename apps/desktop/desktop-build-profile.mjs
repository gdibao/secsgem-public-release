import fs from 'node:fs/promises';
import path from 'node:path';

const requiredAssets = {
  appPreview: '.png',
  nsisHeader: '.bmp',
  nsisSidebar: '.bmp',
  windowsIcon: '.ico',
};

const optionalAssets = {
  linuxIcon: '.png',
  macIcon: '.icns',
};

const applicationIdPattern = /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const packageNamePattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const executableNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9 ()_-]*[A-Za-z0-9()_-])?$/;
const protocolSchemePattern = /^[a-z][a-z0-9+.-]+$/;
const oidcClientIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const artifactPathControlPattern = /[<>:"/\\|?*\x00-\x1F]/;
const allowedArtifactTokens = new Set(['arch', 'ext', 'productName', 'version']);
const windowsReservedNamePattern =
  /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/i;

const profileError = (code) => {
  throw new Error(code);
};

const requireString = (value, code) => {
  if (typeof value !== 'string' || value.length === 0) profileError(code);
  return value;
};

const assertInside = (root, file) => {
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    profileError('DESKTOP_BUILD_PROFILE_PATH_OUTSIDE_STAGING');
  }
  return resolved;
};

const hasOnlyApprovedArtifactInterpolation = (value) => {
  const interpolationPattern = /\$\{([^}]*)\}/g;
  let match;
  let lastIndex = 0;

  while ((match = interpolationPattern.exec(value))) {
    if (!allowedArtifactTokens.has(match[1])) return false;
    lastIndex = match.index + match[0].length;
  }

  return !value.slice(lastIndex).includes('${');
};

const validateProfile = (profile) => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }

  const applicationId = requireString(profile.applicationId, 'DESKTOP_BUILD_PROFILE_INVALID');
  const applicationName = requireString(profile.applicationName, 'DESKTOP_BUILD_PROFILE_INVALID');
  const artifactName = requireString(profile.artifactName, 'DESKTOP_BUILD_PROFILE_INVALID');
  const description = requireString(profile.description, 'DESKTOP_BUILD_PROFILE_INVALID');
  const deviceGatewayUrl = requireString(
    profile.deviceGatewayUrl,
    'DESKTOP_BUILD_PROFILE_INVALID',
  );
  const executableName = requireString(profile.executableName, 'DESKTOP_BUILD_PROFILE_INVALID');
  const homepage = requireString(profile.homepage, 'DESKTOP_BUILD_PROFILE_INVALID');
  const officialCloudServer = requireString(
    profile.officialCloudServer,
    'DESKTOP_BUILD_PROFILE_INVALID',
  );
  const oidcClientId = requireString(profile.oidcClientId, 'DESKTOP_BUILD_PROFILE_INVALID');
  const installerArtifactName = requireString(
    profile.installerArtifactName,
    'DESKTOP_BUILD_PROFILE_INVALID',
  );
  const packageName = requireString(profile.packageName, 'DESKTOP_BUILD_PROFILE_INVALID');
  const protocolScheme = requireString(profile.protocolScheme, 'DESKTOP_BUILD_PROFILE_INVALID');
  const publisher = requireString(profile.publisher, 'DESKTOP_BUILD_PROFILE_INVALID');
  const shortcutName = requireString(profile.shortcutName, 'DESKTOP_BUILD_PROFILE_INVALID');
  const uninstallDisplayName = requireString(
    profile.uninstallDisplayName,
    'DESKTOP_BUILD_PROFILE_INVALID',
  );
  const artifactProductName = applicationName.trim();

  if (!applicationIdPattern.test(applicationId)) profileError('DESKTOP_BUILD_PROFILE_INVALID');
  if (!packageNamePattern.test(packageName)) profileError('DESKTOP_BUILD_PROFILE_INVALID');
  if (
    artifactProductName !== applicationName ||
    artifactProductName === '.' ||
    artifactProductName === '..' ||
    artifactPathControlPattern.test(artifactProductName) ||
    windowsReservedNamePattern.test(artifactProductName)
  ) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (
    !executableNamePattern.test(executableName) ||
    windowsReservedNamePattern.test(executableName.trim())
  ) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (!protocolSchemePattern.test(protocolScheme) || protocolScheme.length > 64) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (!hasOnlyApprovedArtifactInterpolation(installerArtifactName)) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (!hasOnlyApprovedArtifactInterpolation(artifactName)) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (
    artifactPathControlPattern.test(artifactName) ||
    artifactPathControlPattern.test(installerArtifactName)
  ) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  try {
    if (new URL(homepage).protocol !== 'https:') profileError('DESKTOP_BUILD_PROFILE_INVALID');
    const cloudServerUrl = new URL(officialCloudServer);
    const gatewayUrl = new URL(deviceGatewayUrl);
    if (
      cloudServerUrl.protocol !== 'https:' ||
      cloudServerUrl.pathname !== '/' ||
      cloudServerUrl.search ||
      cloudServerUrl.hash
    ) {
      profileError('DESKTOP_BUILD_PROFILE_INVALID');
    }
    if (gatewayUrl.protocol !== 'https:' || gatewayUrl.search || gatewayUrl.hash) {
      profileError('DESKTOP_BUILD_PROFILE_INVALID');
    }
  } catch {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  if (!oidcClientIdPattern.test(oidcClientId)) profileError('DESKTOP_BUILD_PROFILE_INVALID');

  return {
    applicationId,
    applicationName,
    artifactName,
    description,
    deviceGatewayUrl: deviceGatewayUrl.replace(/\/$/, ''),
    executableName,
    homepage,
    installerArtifactName,
    officialCloudServer: officialCloudServer.replace(/\/$/, ''),
    oidcClientId,
    packageName,
    protocolScheme,
    publisher,
    shortcutName,
    uninstallDisplayName,
  };
};

export const loadDesktopBuildProfile = async (profilePath) => {
  if (!profilePath) return null;

  const resolvedProfilePath = path.resolve(profilePath);
  const stagingRoot = path.dirname(resolvedProfilePath);
  const realStagingRoot = await fs.realpath(stagingRoot);
  const parsed = JSON.parse(await fs.readFile(resolvedProfilePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }

  const profile = validateProfile(parsed.profile);
  const assets = {};
  if (!parsed.assets || typeof parsed.assets !== 'object' || Array.isArray(parsed.assets)) {
    profileError('DESKTOP_BUILD_PROFILE_INVALID');
  }

  for (const [kind, extension] of Object.entries({ ...requiredAssets, ...optionalAssets })) {
    if (kind in optionalAssets && parsed.assets[kind] === undefined) continue;
    const file = requireString(parsed.assets[kind], 'DESKTOP_BUILD_PROFILE_INVALID');
    const resolved = assertInside(
      stagingRoot,
      path.isAbsolute(file) ? file : path.join(stagingRoot, file),
    );
    if (path.extname(resolved).toLowerCase() !== extension) {
      profileError('DESKTOP_BUILD_PROFILE_INVALID_ASSET_EXTENSION');
    }
    const realResolved = assertInside(realStagingRoot, await fs.realpath(resolved));
    const stat = await fs.stat(realResolved);
    if (!stat.isFile()) profileError('DESKTOP_BUILD_PROFILE_ASSET_MISSING');
    assets[kind] = realResolved;
  }

  return {
    assets,
    profile,
    profileRevisionId: requireString(parsed.profileRevisionId, 'DESKTOP_BUILD_PROFILE_INVALID'),
    releaseId: requireString(parsed.releaseId, 'DESKTOP_BUILD_PROFILE_INVALID'),
    stagingRoot,
  };
};

export const applyDesktopBuildProfile = (config, stagedProfile) => {
  if (!stagedProfile) return config;

  const { assets, profile } = stagedProfile;
  const {
    CFBundleIconName: _repositoryIconName,
    CFBundleURLTypes: _repositoryUrlTypes,
    ...macExtendInfo
  } = config.mac?.extendInfo ?? {};
  return {
    ...config,
    appId: profile.applicationId,
    appImage: {
      ...(config.appImage ?? {}),
      artifactName: profile.artifactName,
    },
    dmg: {
      ...(config.dmg ?? {}),
      artifactName: profile.artifactName,
    },
    extraMetadata: {
      ...(config.extraMetadata ?? {}),
      author: profile.publisher,
      description: profile.description,
      homepage: profile.homepage,
      name: profile.packageName,
    },
    nsis: {
      ...(config.nsis ?? {}),
      artifactName: profile.installerArtifactName,
      installerHeader: assets.nsisHeader,
      installerSidebar: assets.nsisSidebar,
      shortcutName: profile.shortcutName,
      uninstallDisplayName: profile.uninstallDisplayName,
      uninstallerSidebar: assets.nsisSidebar,
    },
    linux: {
      ...(config.linux ?? {}),
      artifactName: profile.artifactName,
      ...(assets.linuxIcon ? { icon: assets.linuxIcon } : {}),
    },
    mac: {
      ...(config.mac ?? {}),
      artifactName: profile.artifactName,
      ...(assets.macIcon ? { icon: assets.macIcon } : {}),
      extendInfo: macExtendInfo,
    },
    productName: profile.applicationName,
    portable: {
      ...(config.portable ?? {}),
      artifactName: profile.installerArtifactName.replace('-setup.', '-${arch}-portable.'),
      requestExecutionLevel: 'user',
    },
    protocols: [
      {
        name: `${profile.applicationName} Protocol`,
        schemes: [profile.protocolScheme],
      },
    ],
    win: {
      ...(config.win ?? {}),
      executableName: profile.executableName,
      icon: assets.windowsIcon,
    },
  };
};
