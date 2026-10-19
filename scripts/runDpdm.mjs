#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const resolveBin = (packageName) => {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const binPath = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.dpdm;

  if (!binPath) {
    throw new Error(`Package ${packageName} does not expose a dpdm binary`);
  }

  return path.join(path.dirname(packageJsonPath), binPath);
};

// dpdm-fast@1.0.14 does not publish a Windows executable. Keep the fast
// native binary on macOS/Linux, and use the JS implementation on Windows.
const packageName = os.platform() === 'win32' ? 'dpdm' : 'dpdm-fast';
const result = spawnSync(process.execPath, [resolveBin(packageName), ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
