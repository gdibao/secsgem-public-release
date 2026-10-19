import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const copyDirs = ['assets', 'devtools', 'i18n', 'model-bank', 'shiki', 'vendor'] as const;

// Workers are requested root-relative, not from under the entry prefix, because
// `new Worker` needs a same-origin script and the file is byte-identical across
// variants. So this one lands in `public/` itself rather than in each SPA
// directory — a single copy behind a single path.
const rootCopyDirs = ['app-workers'] as const;
const copyRootFilePatterns = [/^favicon.*\.ico$/, /^apple-touch-icon\.png$/] as const;
const defaultTargets = [
  { distDir: 'desktop', publicDir: 'public/_spa' },
  { distDir: 'mobile', publicDir: 'public/_spa' },
  { distDir: 'auth', publicDir: 'public/_spa-auth' },
  { distDir: 'workbench', publicDir: 'public/_spa-workbench' },
  { distDir: 'share', publicDir: 'public/_spa-share' },
] as const;

export type SpaBuildCopyTarget = {
  distDir: string;
  publicDir: string;
};

export const spaPublicDirNames = [
  ...new Set(defaultTargets.map(({ publicDir }) => publicDir.split('/')[1])),
];

const unregisterServiceWorker = `self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
`;

export const copySpaBuild = (
  root = path.resolve(import.meta.dirname, '..'),
  targets: readonly SpaBuildCopyTarget[] = defaultTargets,
) => {
  const cleanedPublicDirs = new Set<string>();

  for (const { publicDir } of targets) {
    if (cleanedPublicDirs.has(publicDir)) continue;

    const spaDir = path.resolve(root, publicDir);
    mkdirSync(spaDir, { recursive: true });

    for (const dir of copyDirs) {
      rmSync(path.resolve(spaDir, dir), { force: true, recursive: true });
    }

    cleanedPublicDirs.add(publicDir);
  }

  for (const { distDir, publicDir } of targets) {
    const distRoot = path.resolve(root, `dist/${distDir}`);
    const spaDir = path.resolve(root, publicDir);
    mkdirSync(spaDir, { recursive: true });

    for (const dir of copyDirs) {
      const sourceDir = path.resolve(distRoot, dir);
      const targetDir = path.resolve(spaDir, dir);

      if (!existsSync(sourceDir)) continue;

      cpSync(sourceDir, targetDir, { recursive: true });
      console.log(`Copied dist/${distDir}/${dir} -> ${publicDir}/${dir}`);
    }

    for (const dir of rootCopyDirs) {
      const sourceDir = path.resolve(distRoot, dir);

      if (!existsSync(sourceDir)) continue;

      cpSync(sourceDir, path.resolve(root, 'public', dir), { recursive: true });
      console.log(`Copied dist/${distDir}/${dir} -> public/${dir}`);
    }

    if (!existsSync(distRoot)) continue;

    for (const file of readdirSync(distRoot)) {
      const sourceFile = path.resolve(distRoot, file);

      if (!statSync(sourceFile).isFile()) continue;
      if (!copyRootFilePatterns.some((pattern) => pattern.test(file))) continue;

      cpSync(sourceFile, path.resolve(spaDir, file));
      console.log(`Copied dist/${distDir}/${file} -> ${publicDir}/${file}`);
    }
  }

  for (const publicDir of cleanedPublicDirs) {
    writeFileSync(path.resolve(root, publicDir, 'sw.js'), unregisterServiceWorker);
  }
};
