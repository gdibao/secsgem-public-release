import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copySpaBuild } from './copySpaBuildCore';

describe('copySpaBuild', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (!root) return;

    await rm(root, { force: true, recursive: true });
    root = undefined;
  });

  it('preserves desktop and mobile assets copied into the shared public SPA directory', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'copy-spa-build-'));

    await writeFixture('dist/desktop/assets/desktop-entry.js', 'desktop');
    await writeFixture('dist/desktop/favicon.ico', 'favicon');
    await writeFixture('dist/mobile/assets/mobile-entry.js', 'mobile');
    await writeFixture('dist/mobile/apple-touch-icon.png', 'touch-icon');
    await writeFixture('dist/mobile/index.html', 'ignored');
    await writeFixture('public/_spa/assets/stale.js', 'stale');

    copySpaBuild(root, [
      { distDir: 'desktop', publicDir: 'public/_spa' },
      { distDir: 'mobile', publicDir: 'public/_spa' },
    ]);

    await expect(readFile(path.join(root, 'public/_spa/assets/desktop-entry.js'), 'utf8'))
      .resolves.toBe('desktop');
    await expect(readFile(path.join(root, 'public/_spa/assets/mobile-entry.js'), 'utf8'))
      .resolves.toBe('mobile');
    await expect(readFile(path.join(root, 'public/_spa/favicon.ico'), 'utf8')).resolves.toBe(
      'favicon',
    );
    await expect(readFile(path.join(root, 'public/_spa/apple-touch-icon.png'), 'utf8')).resolves.toBe(
      'touch-icon',
    );
    await expect(readFile(path.join(root, 'public/_spa/index.html'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(root, 'public/_spa/assets/stale.js'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(root, 'public/_spa/sw.js'), 'utf8')).resolves.toContain(
      'self.registration.unregister()',
    );
  });

  const writeFixture = async (relativePath: string, content: string) => {
    if (!root) throw new Error('test root is not initialized');

    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  };
});
