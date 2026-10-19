import fs from 'node:fs/promises';
import path from 'node:path';

const [rootArgument, platform, arch] = process.argv.slice(2);
if (!rootArgument || !platform || !arch) {
  throw new Error('USAGE: validatePackagedRuntime.mjs <package-root> <platform> <arch>');
}

const root = path.resolve(rootArgument);
const requiredPackage = `@lydell/node-pty-${platform}-${arch}`;
const requiredBinding =
  platform === 'win32'
    ? path.join('prebuilds', `${platform}-${arch}`, 'conpty.node')
    : path.join('prebuilds', `${platform}-${arch}`, 'pty.node');

const matches = [];

const walk = async (entry) => {
  const stat = await fs.stat(entry);
  if (stat.isFile()) {
    const normalized = entry.split(path.sep).join('/');
    const suffix = `app.asar.unpacked/node_modules/${requiredPackage}/${requiredBinding}`;
    if (normalized.endsWith(suffix)) matches.push(entry);
    return;
  }

  for (const child of await fs.readdir(entry, { withFileTypes: true })) {
    await walk(path.join(entry, child.name));
  }
};

await walk(root);

if (matches.length === 0) {
  throw new Error(`PACKAGED_RUNTIME_NATIVE_DEPENDENCY_MISSING:${requiredPackage}:${root}`);
}

for (const match of matches) {
  const stat = await fs.stat(match);
  if (stat.size === 0) throw new Error(`PACKAGED_RUNTIME_NATIVE_BINDING_EMPTY:${match}`);
  console.info(`Packaged runtime dependency verified: ${requiredPackage} (${match})`);
}
