import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = {
  description: source.description,
  exports: { '.': { import: './index.js', types: './index.d.ts' } },
  license: 'MIT',
  main: './index.js',
  name: source.name,
  repository: {
    directory: 'packages/module-app-sdk',
    type: 'git',
    url: 'https://github.com/maheshenga/comhub.git',
  },
  type: 'module',
  types: './index.d.ts',
  version: source.version,
};

await mkdir(path.join(root, 'dist'), { recursive: true });
await Promise.all([
  copyFile(path.join(root, 'README.md'), path.join(root, 'dist', 'README.md')),
  writeFile(path.join(root, 'dist', 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`),
]);
