import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const realRoot = await realpath(root);
const paths = process.argv.slice(2);

if (paths.length === 0) throw new Error('At least one path is required');

const isWithin = (base, target) => {
  const relative = path.relative(base, target);

  return (
    !relative ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const resolveNearestExistingPath = async (target) => {
  let current = target;

  while (true) {
    try {
      await lstat(current);
      return realpath(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;

      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
};

const targets = [];

for (const input of paths) {
  const target = path.resolve(root, input);
  if (target === root || !isWithin(root, target)) {
    throw new Error(`Refusing to remove a path outside the working directory: ${input}`);
  }

  const realTarget = await resolveNearestExistingPath(target);
  if (!isWithin(realRoot, realTarget)) {
    throw new Error(`Refusing to remove a path outside the working directory: ${input}`);
  }

  targets.push(target);
}

for (const target of targets) {
  await rm(target, { force: true, recursive: true });
}
