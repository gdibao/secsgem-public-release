// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirs: string[] = [];

const createDesktopPackage = async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'desktop-version-'));
  temporaryDirs.push(rootDir);
  const desktopDir = path.join(rootDir, 'apps', 'desktop');
  const buildDir = path.join(desktopDir, 'build');
  await mkdir(desktopDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  const packagePath = path.join(desktopDir, 'package.json');
  await writeFile(
    packagePath,
    JSON.stringify({
      name: 'lobehub-desktop-dev',
      productName: 'ComHub',
      version: '0.0.0',
    }),
  );
  return { buildDir, packagePath, rootDir };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe('setDesktopVersion', () => {
  it('updates version and release package name without overwriting productName', async () => {
    const { packagePath, rootDir } = await createDesktopPackage();
    const { updateDesktopPackageJson } = await import('./setDesktopVersion');

    await updateDesktopPackageJson({
      releaseType: 'nightly',
      rootDir,
      version: '2.4.0-nightly.1',
    });

    const updated = JSON.parse(await readFile(packagePath, 'utf8'));
    expect(updated).toMatchObject({
      name: 'lobehub-desktop-nightly',
      productName: 'ComHub',
      version: '2.4.0-nightly.1',
    });
  });

  it('does not copy repository icons when a staged desktop build profile is active', async () => {
    const { buildDir, rootDir } = await createDesktopPackage();
    const iconPath = path.join(buildDir, 'icon.png');
    await writeFile(iconPath, 'original');
    await writeFile(path.join(buildDir, 'icon-nightly.png'), 'nightly');
    const { updateDesktopPackageJson } = await import('./setDesktopVersion');

    await updateDesktopPackageJson({
      releaseType: 'nightly',
      rootDir,
      version: '2.4.0-nightly.1',
    });
    expect(await readFile(iconPath, 'utf8')).toBe('nightly');

    await writeFile(iconPath, 'profile-owned');
    await updateDesktopPackageJson({
      copyRepositoryIcons: false,
      releaseType: 'nightly',
      rootDir,
      version: '2.4.0-nightly.2',
    });
    expect(await readFile(iconPath, 'utf8')).toBe('profile-owned');
  });
});
