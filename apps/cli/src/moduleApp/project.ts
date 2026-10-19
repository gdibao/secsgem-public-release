import { lstat, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { containsModuleAppSecret, isSensitiveModuleAppPath } from '@lobechat/module-app-build';
import {
  MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES,
  type ModuleAppPackageManifest,
  moduleAppPackageManifestV1Schema,
  moduleAppPackageManifestV2Schema,
} from '@lobechat/types';
import fg from 'fast-glob';
import { zipSync } from 'fflate';
import ignore from 'ignore';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const MAX_FILE_COUNT = 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024;
const fastGlobIgnored = ['**/.git/**', '**/node_modules/**', '**/.DS_Store', '**/Thumbs.db'];
const defaultIgnore = ignore().add([
  '.git/',
  '**/.git/',
  'node_modules/',
  '**/node_modules/',
  '.DS_Store',
  '**/.DS_Store',
  'Thumbs.db',
  '**/Thumbs.db',
  '.moduleappignore',
]);

export class ModuleAppProjectError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'ModuleAppProjectError';
  }
}

const pathExists = async (target: string) => {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const validateModuleAppProject = async (
  directory: string,
): Promise<{ manifest: ModuleAppPackageManifest; manifestPath: string }> => {
  const root = path.resolve(directory);
  const yamlPath = path.join(root, 'module-app.yaml');
  const jsonPath = path.join(root, 'manifest.json');
  const [hasYaml, hasJson] = await Promise.all([pathExists(yamlPath), pathExists(jsonPath)]);
  if (hasYaml === hasJson) {
    throw new ModuleAppProjectError(
      hasYaml ? 'MODULE_APP_MANIFEST_CONFLICT' : 'MODULE_APP_MANIFEST_MISSING',
    );
  }

  const manifestPath = hasYaml ? yamlPath : jsonPath;
  let source: unknown;
  try {
    const text = await readFile(manifestPath, 'utf8');
    source = hasYaml ? parseYaml(text) : JSON.parse(text);
  } catch (error) {
    throw new ModuleAppProjectError('MODULE_APP_MANIFEST_PARSE_FAILED', String(error));
  }

  const parsed = hasYaml
    ? moduleAppPackageManifestV2Schema.safeParse(source)
    : moduleAppPackageManifestV1Schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('\n');
    throw new ModuleAppProjectError('MODULE_APP_MANIFEST_INVALID', issues);
  }

  return { manifest: parsed.data, manifestPath };
};

const loadProjectIgnore = async (root: string) => {
  const projectIgnore = ignore();
  const ignorePath = path.join(root, '.moduleappignore');
  if (await pathExists(ignorePath)) projectIgnore.add(await readFile(ignorePath, 'utf8'));
  return projectIgnore;
};

export const packModuleAppProject = async (input: {
  directory: string;
  onFilesCollected?: (files: readonly string[]) => void;
  output?: string;
}) => {
  const root = path.resolve(input.directory);
  const { manifest } = await validateModuleAppProject(root);
  const output = path.resolve(
    input.output ?? path.join(root, `${manifest.app.slug}-${manifest.packageVersion}.zip`),
  );
  const outputRelative = path.relative(root, output).replaceAll('\\', '/');
  const projectIgnore = await loadProjectIgnore(root);
  const candidates = await fg('**/*', {
    absolute: false,
    cwd: root,
    dot: true,
    followSymbolicLinks: false,
    ignore:
      outputRelative && !outputRelative.startsWith('../')
        ? [...fastGlobIgnored, outputRelative]
        : fastGlobIgnored,
    onlyFiles: false,
  });
  const files: string[] = [];
  for (const candidate of candidates.sort()) {
    const normalized = candidate.replaceAll('\\', '/');
    const candidateStat = await lstat(path.join(root, candidate));
    const ignorePath = candidateStat.isDirectory() ? `${normalized}/` : normalized;
    if (defaultIgnore.ignores(ignorePath)) continue;
    if (candidateStat.isFile() && isSensitiveModuleAppPath(normalized)) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_SENSITIVE_FILE', normalized);
    }
    if (projectIgnore.ignores(ignorePath)) continue;
    if (
      candidateStat.isSymbolicLink() ||
      (!candidateStat.isDirectory() && !candidateStat.isFile())
    ) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_TYPE_UNSUPPORTED', normalized);
    }
    if (candidateStat.isFile()) {
      files.push(candidate);
    }
  }
  if (files.length === 0 || files.length > MAX_FILE_COUNT) {
    throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_COUNT_INVALID');
  }
  input.onFilesCollected?.(files.map((file) => file.replaceAll('\\', '/')));

  const entries: Record<string, Uint8Array> = {};
  let totalFileBytes = 0;
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    const filePath = path.join(root, file);
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_TYPE_UNSUPPORTED', normalized);
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_TOO_LARGE', normalized);
    }
    totalFileBytes += fileStat.size;
    if (totalFileBytes > MAX_TOTAL_FILE_BYTES) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_EXPANDED_TOO_LARGE');
    }
    const handle = await open(filePath, 'r');
    let bytes: Uint8Array;
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        openedStat.dev !== fileStat.dev ||
        openedStat.ino !== fileStat.ino ||
        openedStat.size !== fileStat.size
      ) {
        throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_CHANGED', normalized);
      }
      bytes = await handle.readFile();
      const completedStat = await handle.stat();
      if (
        bytes.byteLength !== openedStat.size ||
        completedStat.size !== openedStat.size ||
        completedStat.mtimeMs !== openedStat.mtimeMs ||
        completedStat.ctimeMs !== openedStat.ctimeMs
      ) {
        throw new ModuleAppProjectError('MODULE_APP_PACKAGE_FILE_CHANGED', normalized);
      }
    } finally {
      await handle.close();
    }
    if (containsModuleAppSecret(bytes)) {
      throw new ModuleAppProjectError('MODULE_APP_PACKAGE_SECRET_DETECTED', normalized);
    }
    entries[normalized] = bytes;
  }

  const archive = zipSync(entries, { level: 6 });
  if (archive.byteLength > MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES) {
    throw new ModuleAppProjectError('MODULE_APP_PACKAGE_ARCHIVE_TOO_LARGE');
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, archive);

  return { fileCount: files.length, output, sizeBytes: archive.byteLength };
};

const scaffoldManifest = (slug: string, displayName: string) => ({
  app: {
    actions: [],
    appType: 'standard_app',
    billing: { chargeMode: 'free' },
    category: 'productivity',
    description: `${displayName} module application.`,
    displayName,
    icon: 'Box',
    pages: [],
    slug,
    source: 'developer',
    status: 'draft',
    tags: [],
  },
  build: { frontend: { output: 'dist', profile: 'node22-static' } },
  entitlements: [],
  manifestVersion: 2,
  packageVersion: '0.1.0',
  runtime: { functions: [], outboundHosts: [], permissions: [] },
});

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const scaffoldPackageJson = (slug: string) =>
  JSON.stringify(
    {
      dependencies: { '@lobechat/module-app-sdk': '^0.1.0' },
      devDependencies: {
        typescript: '^6.0.3',
        vite: '^7.0.0',
        vitest: '^3.2.6',
      },
      name: slug,
      private: true,
      scripts: {
        build: 'tsc --noEmit && vite build',
        dev: 'vite',
        test: 'vitest run',
      },
      type: 'module',
      version: '0.1.0',
    },
    null,
    2,
  ) + '\n';

const scaffoldMain = (displayName: string) =>
  [
    "import { createModuleAppSdk, waitForModuleAppLaunch } from '@lobechat/module-app-sdk';",
    '',
    "import { greeting } from './greeting';",
    '',
    "const root = document.querySelector<HTMLElement>('#app');",
    "const nonce = new URLSearchParams(location.search).get('nonce');",
    "if (!root || !nonce) throw new Error('MODULE_APP_BOOTSTRAP_INVALID');",
    '',
    'const launch = await waitForModuleAppLaunch({ nonce });',
    'const sdk = createModuleAppSdk({ nonce, runtimeOrigin: launch.hostOrigin });',
    'const context = await sdk.context();',
    'root.textContent = greeting(' +
      JSON.stringify(displayName) +
      ") + ' (' + String(context.mode ?? 'runtime') + ')';",
    '',
  ].join('\n');

export const initializeModuleAppProject = async (input: {
  directory: string;
  displayName?: string;
  slug?: string;
}) => {
  const root = path.resolve(input.directory);
  const slug =
    input.slug ??
    path
      .basename(root)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ModuleAppProjectError('MODULE_APP_SLUG_INVALID');
  }
  const displayName = input.displayName?.trim() || slug;
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) {
    throw new ModuleAppProjectError('MODULE_APP_PROJECT_DIRECTORY_NOT_EMPTY');
  }
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, '.moduleappignore'),
      [
        'node_modules/',
        '/src/',
        '/index.html',
        '/package.json',
        '/pnpm-lock.yaml',
        '/package-lock.json',
        '/bun.lock',
        '/bun.lockb',
        '/tsconfig.json',
        '/vite.config.ts',
      ].join('\n') + '\n',
      'utf8',
    ),
    writeFile(
      path.join(root, 'index.html'),
      '<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
        escapeHtml(displayName) +
        '</title><main id="app"></main><script type="module" src="/src/main.ts"></script></html>\n',
      'utf8',
    ),
    writeFile(path.join(root, 'package.json'), scaffoldPackageJson(slug), 'utf8'),
    writeFile(
      path.join(root, 'src', 'greeting.test.ts'),
      "import { describe, expect, it } from 'vitest';\n\nimport { greeting } from './greeting';\n\ndescribe('greeting', () => {\n  it('formats the application name', () => {\n    expect(greeting('Example')).toBe('Example is ready');\n  });\n});\n",
      'utf8',
    ),
    writeFile(
      path.join(root, 'src', 'greeting.ts'),
      "export const greeting = (name: string) => name + ' is ready';\n",
      'utf8',
    ),
    writeFile(path.join(root, 'src', 'main.ts'), scaffoldMain(displayName), 'utf8'),
    writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            lib: ['DOM', 'ES2023'],
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
            strict: true,
            target: 'ES2023',
          },
          include: ['src', 'vite.config.ts'],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    ),
    writeFile(
      path.join(root, 'vite.config.ts'),
      "import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  build: { emptyOutDir: true, outDir: 'dist' },\n});\n",
      'utf8',
    ),
    writeFile(
      path.join(root, 'module-app.yaml'),
      stringifyYaml(scaffoldManifest(slug, displayName)),
      'utf8',
    ),
    writeFile(
      path.join(root, 'dist', 'index.html'),
      `<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>${escapeHtml(displayName)}</title><main id="app">${escapeHtml(displayName)}</main></html>\n`,
      'utf8',
    ),
  ]);

  await validateModuleAppProject(root);
  return { directory: root, slug };
};
