import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const resolvePackageBin = async (packageName, binName, requireFrom) => {
  const require = createRequire(requireFrom);
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const binPath =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];

  if (!binPath) throw new Error(`Package ${packageName} does not expose the ${binName} binary`);

  return path.resolve(path.dirname(packageJsonPath), binPath);
};
