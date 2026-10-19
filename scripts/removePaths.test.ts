import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(process.cwd(), 'scripts/removePaths.mjs');
const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'remove-paths-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('removePaths', () => {
  it('removes each requested path relative to the working directory', async () => {
    const cwd = await createWorkspace();
    const first = path.join(cwd, 'public', '_spa');
    const second = path.join(cwd, 'dist', 'share');
    const retained = path.join(cwd, 'retained.txt');

    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(retained, 'keep');

    const result = spawnSync(process.execPath, [script, 'public/_spa', 'dist/share'], {
      cwd,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(existsSync(retained)).toBe(true);
  });

  it('refuses to remove the working directory', async () => {
    const cwd = await createWorkspace();
    const retained = path.join(cwd, 'retained.txt');
    await writeFile(retained, 'keep');

    const result = spawnSync(process.execPath, [script, '.'], { cwd, encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing to remove a path outside the working directory');
    expect(existsSync(retained)).toBe(true);
  });

  it('validates every real path before deleting through an external directory link', async () => {
    const cwd = await createWorkspace();
    const external = await createWorkspace();
    const removable = path.join(cwd, 'removable');
    const externalShare = path.join(external, 'share');
    const externalFile = path.join(externalShare, 'retained.txt');

    await mkdir(removable);
    await mkdir(externalShare);
    await writeFile(externalFile, 'keep');
    await symlink(
      external,
      path.join(cwd, 'dist'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = spawnSync(process.execPath, [script, 'removable', 'dist/share'], {
      cwd,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing to remove a path outside the working directory');
    expect(existsSync(removable)).toBe(true);
    expect(existsSync(externalFile)).toBe(true);
  });
});
