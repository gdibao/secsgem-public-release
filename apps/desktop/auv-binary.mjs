import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
]);

const TARGET_PACKAGES = new Map([
  ['darwin-arm64', ['@auv-js/cli-darwin-arm64', 'bin/auv']],
  ['darwin-x64', ['@auv-js/cli-darwin-x64', 'bin/auv']],
  ['linux-arm64', ['@auv-js/cli-linux-arm64-gnu', 'bin/auv']],
  ['linux-x64', ['@auv-js/cli-linux-x64-gnu', 'bin/auv']],
  ['win32-x64', ['@auv-js/cli-win32-x64-msvc', 'bin/auv.exe']],
]);

export const normalizeBuilderArch = (arch) => {
  if (typeof arch === 'string') return arch;
  return ARCH_NAMES.get(arch);
};

export const getAuvTarget = (platform, arch) => {
  const normalizedArch = normalizeBuilderArch(arch);
  const target = TARGET_PACKAGES.get(`${platform}-${normalizedArch}`);

  if (!target) {
    throw new Error(`AUV does not publish an executable for ${platform}/${normalizedArch ?? arch}`);
  }

  const [packageName, binaryRelativePath] = target;
  return { binaryRelativePath, executable: path.basename(binaryRelativePath), packageName };
};

export const resolveAuvBinaryForTarget = async (platform, arch, fromUrl = import.meta.url) => {
  const { binaryRelativePath, executable, packageName } = getAuvTarget(platform, arch);
  const require = createRequire(fromUrl);
  let manifestPath;

  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (cause) {
    throw new Error(
      `The target AUV package ${packageName} is missing. Install target optional dependencies before packaging.`,
      { cause },
    );
  }

  const binaryPath = path.join(path.dirname(manifestPath), binaryRelativePath);
  await fs.access(
    binaryPath,
    platform === process.platform && platform !== 'win32' ? constants.X_OK : constants.F_OK,
  );
  return { binaryPath, executable, packageName };
};
