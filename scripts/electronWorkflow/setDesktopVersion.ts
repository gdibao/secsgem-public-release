import path from 'node:path';
import { pathToFileURL } from 'node:url';

import fs from 'fs-extra';

export type ReleaseType = 'stable' | 'beta' | 'nightly' | 'canary';

const releasePackageNames: Record<ReleaseType, string> = {
  beta: 'lobehub-desktop-beta',
  canary: 'lobehub-desktop-canary',
  nightly: 'lobehub-desktop-nightly',
  stable: 'lobehub-desktop',
};

function updateAppIcon(rootDir: string, type: 'beta' | 'nightly') {
  const buildDir = path.join(rootDir, 'apps/desktop/build');
  console.log(`Updating app icon for ${type} version...`);
  try {
    const iconSuffix = type === 'beta' ? 'beta' : 'nightly';
    const iconMappings = [
      { source: `icon-${iconSuffix}.png`, target: 'icon.png' },
      { source: `Icon-${iconSuffix}.icns`, target: 'Icon.icns' },
      { source: `icon-${iconSuffix}.ico`, target: 'icon.ico' },
    ];

    for (const mapping of iconMappings) {
      const sourceFile = path.join(buildDir, mapping.source);
      const targetFile = path.join(buildDir, mapping.target);

      if (fs.existsSync(sourceFile) && sourceFile !== targetFile) {
        fs.copyFileSync(sourceFile, targetFile);
        console.log(`  Copied ${mapping.source} to ${mapping.target}`);
      } else if (!fs.existsSync(sourceFile)) {
        console.warn(`  Warning: Source icon not found: ${sourceFile}`);
      }
    }
  } catch (error) {
    console.error('  Error updating icons:', error);
  }
}

export function updateDesktopPackageJson({
  copyRepositoryIcons = !process.env.DESKTOP_BUILD_PROFILE_PATH,
  releaseType,
  rootDir = path.resolve(__dirname, '../..'),
  version,
}: {
  copyRepositoryIcons?: boolean;
  releaseType: ReleaseType;
  rootDir?: string;
  version: string;
}) {
  if (!releasePackageNames[releaseType]) {
    throw new Error(
      `Invalid release type: ${releaseType}. Must be one of 'stable', 'beta', 'nightly', 'canary'.`,
    );
  }

  const desktopPackageJsonPath = path.join(rootDir, 'apps/desktop/package.json');
  console.log(`Updating ${desktopPackageJsonPath} for ${releaseType} version ${version}...`);

  if (!fs.existsSync(desktopPackageJsonPath)) {
    throw new Error(`File not found ${desktopPackageJsonPath}`);
  }

  const packageJson = fs.readJSONSync(desktopPackageJsonPath);
  packageJson.version = version;
  packageJson.name = releasePackageNames[releaseType];

  if (releaseType === 'beta') {
    console.log('Setting as Beta version.');
    if (copyRepositoryIcons) updateAppIcon(rootDir, 'beta');
  } else if (releaseType === 'nightly') {
    console.log('Setting as Nightly version.');
    if (copyRepositoryIcons) updateAppIcon(rootDir, 'nightly');
  } else if (releaseType === 'canary') {
    console.log('Setting as Canary version.');
  } else {
    console.log('Setting as Stable version.');
  }

  fs.writeJsonSync(desktopPackageJsonPath, packageJson, { spaces: 2 });
  console.log(`Desktop app package.json updated successfully for ${releaseType} ${version}.`);
}

function runCli() {
  const version = process.argv[2];
  const releaseType = process.argv[3] as ReleaseType;

  if (!version || !releaseType) {
    console.error(
      'Missing parameters. Usage: bun run setDesktopVersion.ts <version> <stable|beta|nightly|canary>',
    );
    process.exit(1);
  }

  try {
    updateDesktopPackageJson({ releaseType, version });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
