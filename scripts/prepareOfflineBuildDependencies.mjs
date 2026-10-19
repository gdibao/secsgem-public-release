import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const archive = process.env.FAB_OFFLINE_SHEETJS_ARCHIVE || '/opt/fab-build-deps/xlsx-0.20.3.tgz';
const expectedHash = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8';
const source = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
const manifests = [
  'packages/eval-dataset-parser/package.json',
  'packages/file-loaders/package.json',
];

if (!existsSync(archive)) {
  console.log('Offline SheetJS cache is absent; preserving the upstream dependency URL.');
  process.exit(0);
}

const actualHash = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (actualHash !== expectedHash) {
  throw new Error(`Offline SheetJS cache hash mismatch: ${actualHash}`);
}

for (const manifest of manifests) {
  const content = readFileSync(manifest, 'utf8');
  if (!content.includes(source)) {
    throw new Error(`Expected SheetJS source URL is missing from ${manifest}`);
  }

  writeFileSync(manifest, content.replaceAll(source, `file:${archive}`));
}

console.log(`Using verified offline SheetJS cache (${expectedHash}).`);
