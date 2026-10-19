import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePackageBin } from './packageBin.mjs';

const authPackage = path.resolve(process.cwd(), 'apps/auth/package.json');

describe('resolvePackageBin', () => {
  it.each([
    ['@react-router/dev', 'react-router'],
    ['vite', 'vite'],
  ])('resolves an executable JavaScript entry for %s', async (packageName, binName) => {
    const bin = await resolvePackageBin(packageName, binName, authPackage);

    expect(existsSync(bin)).toBe(true);
    expect(path.extname(bin)).toMatch(/\.c?js$/u);

    const result = spawnSync(process.execPath, [bin, '--version'], {
      cwd: path.dirname(authPackage),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
  });
});
