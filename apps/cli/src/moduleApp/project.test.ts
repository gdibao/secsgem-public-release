import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { startModuleAppDevServer } from './devServer';
import type { ModuleAppProjectError } from './project';
import {
  initializeModuleAppProject,
  packModuleAppProject,
  validateModuleAppProject,
} from './project';

describe('Module App project tools', () => {
  it('initializes, validates, and packages a safe v2 project', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-'));
    const directory = path.join(parent, 'sample-app');
    await initializeModuleAppProject({ directory, displayName: 'Sample App' });

    await expect(validateModuleAppProject(directory)).resolves.toMatchObject({
      manifest: { app: { slug: 'sample-app' }, manifestVersion: 2 },
    });
    await expect(readFile(path.join(directory, 'src', 'main.ts'), 'utf8')).resolves.toContain(
      'createModuleAppSdk',
    );
    await expect(readFile(path.join(directory, 'package.json'), 'utf8')).resolves.toContain(
      '"build": "tsc --noEmit && vite build"',
    );
    await expect(readFile(path.join(directory, 'module-app.yaml'), 'utf8')).resolves.toContain(
      'outboundHosts: []',
    );
    await expect(
      readFile(path.join(directory, 'src', 'greeting.test.ts'), 'utf8'),
    ).resolves.toContain("describe('greeting'");
    const packed = await packModuleAppProject({ directory });
    const entries = unzipSync(await readFile(packed.output));
    expect(Object.keys(entries).sort()).toEqual(['dist/index.html', 'module-app.yaml']);
  });

  it('rejects an invalid manifest before packaging', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-invalid-'));
    await writeFile(path.join(directory, 'module-app.yaml'), 'manifestVersion: 2\n');

    await expect(validateModuleAppProject(directory)).rejects.toMatchObject<ModuleAppProjectError>({
      code: 'MODULE_APP_MANIFEST_INVALID',
    });
  });

  it('rejects symbolic links instead of silently omitting them', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-link-'));
    const directory = path.join(parent, 'linked-app');
    await initializeModuleAppProject({ directory, displayName: 'Linked App' });
    await symlink(
      path.join(directory, 'dist', 'index.html'),
      path.join(directory, 'linked-index.html'),
      'file',
    );

    await expect(packModuleAppProject({ directory })).rejects.toMatchObject<ModuleAppProjectError>({
      code: 'MODULE_APP_PACKAGE_FILE_TYPE_UNSUPPORTED',
    });
  });

  it('rejects sensitive files even when they are valid project files', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-secret-file-'));
    const directory = path.join(parent, 'secret-app');
    await initializeModuleAppProject({ directory, displayName: 'Secret App' });
    await writeFile(path.join(directory, '.env.production'), 'API_KEY=do-not-package');

    await expect(packModuleAppProject({ directory })).rejects.toMatchObject<ModuleAppProjectError>({
      code: 'MODULE_APP_PACKAGE_SENSITIVE_FILE',
    });
  });

  it('rejects high-confidence private key signatures in ordinary files', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-secret-content-'));
    const directory = path.join(parent, 'secret-content-app');
    await initializeModuleAppProject({ directory, displayName: 'Secret Content App' });
    await writeFile(
      path.join(directory, 'dist', 'config.txt'),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key',
    );

    await expect(packModuleAppProject({ directory })).rejects.toMatchObject<ModuleAppProjectError>({
      code: 'MODULE_APP_PACKAGE_SECRET_DETECTED',
    });
  });

  it('applies .moduleappignore and reports the final file manifest before writing', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-ignore-'));
    const directory = path.join(parent, 'ignored-app');
    await initializeModuleAppProject({ directory, displayName: 'Ignored App' });
    await writeFile(path.join(directory, 'notes.txt'), 'local notes');
    const ignorePath = path.join(directory, '.moduleappignore');
    const scaffoldIgnore = await readFile(ignorePath, 'utf8');
    await writeFile(ignorePath, `${scaffoldIgnore}notes.txt\n`);
    const manifests: string[][] = [];

    const packed = await packModuleAppProject({
      directory,
      onFilesCollected: (files) => manifests.push([...files]),
    });
    const entries = unzipSync(await readFile(packed.output));

    expect(manifests).toEqual([['dist/index.html', 'module-app.yaml']]);
    expect(Object.keys(entries).sort()).toEqual(['dist/index.html', 'module-app.yaml']);
  });

  it('does not allow .moduleappignore to hide a sensitive path', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-secret-ignore-'));
    const directory = path.join(parent, 'secret-ignore-app');
    await initializeModuleAppProject({ directory, displayName: 'Secret Ignore App' });
    await writeFile(path.join(directory, '.env.production'), 'API_KEY=do-not-package');
    await writeFile(path.join(directory, '.moduleappignore'), '.env.production\n');

    await expect(packModuleAppProject({ directory })).rejects.toMatchObject<ModuleAppProjectError>({
      code: 'MODULE_APP_PACKAGE_SENSITIVE_FILE',
    });
  });

  it('serves the generated application through the local SDK bridge host', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'module-app-cli-dev-'));
    const directory = path.join(parent, 'preview-app');
    await initializeModuleAppProject({ directory, displayName: 'Preview "App"' });
    const server = await startModuleAppDevServer({ directory, port: 0 });

    try {
      const host = await fetch(server.url);
      expect(host.status).toBe(200);
      const hostHtml = await host.text();
      expect(hostHtml).toContain('comhub.module-app-sdk.v1');
      expect(hostHtml).toContain('<iframe id="module-app"></iframe>');
      expect(hostHtml).toContain('frame.title="Preview \\"App\\"";');
      expect(hostHtml).toContain("new EventSource('/__module_app_events')");
      expect(hostHtml).toContain("message.method==='data.transaction'");
      expect(hostHtml).toContain('rows.splice(0,rows.length,...staged)');
      const app = await fetch(`${server.url}/__module_app_files/index.html`);
      expect(app.status).toBe(200);
      expect(await app.text()).toContain('Preview &quot;App&quot;');
    } finally {
      await server.close();
    }
  });
});
