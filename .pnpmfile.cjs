const betterCallVersion = '1.3.5';

function readPackage(pkg) {
  if (pkg.name !== 'better-call' || pkg.version !== betterCallVersion) return pkg;

  // Keep Better Call's Zod 4 runtime aligned with Better Auth without migrating root Zod 3 consumers.
  pkg.dependencies = { ...pkg.dependencies, zod: '^4.3.6' };

  delete pkg.peerDependencies?.zod;
  if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length === 0) {
    delete pkg.peerDependencies;
  }

  delete pkg.peerDependenciesMeta?.zod;
  if (pkg.peerDependenciesMeta && Object.keys(pkg.peerDependenciesMeta).length === 0) {
    delete pkg.peerDependenciesMeta;
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
