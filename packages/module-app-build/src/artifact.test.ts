import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

import { pack, type Headers, type Pack } from 'tar-stream';
import { describe, expect, it } from 'vitest';

import {
  buildDeterministicModuleAppArtifact,
  inspectModuleAppArtifact,
} from '@lobechat/module-app-build';

const encoder = new TextEncoder();

const reverseObject = <T>(value: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(value).reverse());

const addTarEntry = (archive: Pack, header: Headers, bytes?: Uint8Array) =>
  new Promise<void>((resolve, reject) => {
    archive.entry(header, Buffer.from(bytes ?? new Uint8Array()), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

const createTgz = async (
  entries: Array<Headers & { bytes?: Uint8Array }>,
): Promise<Uint8Array> => {
  const archive = pack();
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const tarBytes = await new Promise<Uint8Array>((resolve, reject) => {
    archive.once('error', reject);
    archive.once('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));

    void (async () => {
      try {
        for (const { bytes, ...header } of entries) await addTarEntry(archive, header, bytes);
        archive.finalize();
      } catch (error) {
        archive.destroy(error instanceof Error ? error : new Error('Unable to create tar fixture.'));
      }
    })();
  });

  return new Uint8Array(gzipSync(tarBytes, { level: 9 }));
};

describe('module app artifacts', () => {
  it('builds a byte-stable canonical archive and reports canonical headers', async () => {
    const files = {
      'dist/assets/app.js': encoder.encode('console.log("hello");'),
      'dist/index.html': encoder.encode('<main>Hello</main>'),
      'module-app.yaml': encoder.encode('manifestVersion: 2\n'),
    };

    const first = await buildDeterministicModuleAppArtifact({ files });
    const second = await buildDeterministicModuleAppArtifact({ files: reverseObject(files) });

    expect(second.bytes).toEqual(first.bytes);
    expect(second.sha256).toBe(first.sha256);
    expect(Array.from(first.bytes.slice(0, 10))).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);

    const entries = await inspectModuleAppArtifact(first.bytes);

    expect(entries.map((entry) => entry.path)).toEqual([
      'dist',
      'dist/assets',
      'dist/assets/app.js',
      'dist/index.html',
      'module-app.yaml',
    ]);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gid: 0,
          gname: '',
          mode: 0o555,
          mtime: new Date(0),
          path: 'dist',
          type: 'directory',
          uid: 0,
          uname: '',
        }),
        expect.objectContaining({
          gid: 0,
          gname: '',
          mode: 0o444,
          mtime: new Date(0),
          path: 'dist/index.html',
          type: 'file',
          uid: 0,
          uname: '',
        }),
      ]),
    );
  });

  it.each(['../secret.txt', '/absolute.txt', 'C:\\absolute.txt', 'dist\\index.html'])(
    'rejects unsafe input path %s',
    async (path) => {
      await expect(
        buildDeterministicModuleAppArtifact({ files: { [path]: encoder.encode('unsafe') } }),
      ).rejects.toMatchObject({ code: 'module_app_package_unsafe_path' });
    },
  );

  it('counts synthesized and explicit directory entries toward the archive entry limit', async () => {
    const bytes = await createTgz(
      Array.from({ length: 1001 }, (_, index) => ({
        name: `directories/${index.toString().padStart(4, '0')}`,
        type: 'directory' as const,
      })),
    );

    await expect(inspectModuleAppArtifact(bytes)).rejects.toMatchObject({
      code: 'module_app_package_too_many_files',
    });
  });

  it(
    'rejects a file whose synthesized parent directories exceed the archive entry limit',
    async () => {
      const path = `${Array.from({ length: 1000 }, (_, index) => `nested-${index}`).join('/')}/index.html`;

      await expect(
        buildDeterministicModuleAppArtifact({ files: { [path]: encoder.encode('<main>Hello</main>') } }),
      ).rejects.toMatchObject({ code: 'module_app_package_too_many_files' });
    },
    20_000,
  );

  it('rejects unsupported tar entry types', async () => {
    const bytes = await createTgz([{ linkname: 'target.txt', name: 'shortcut', type: 'symlink' }]);

    await expect(inspectModuleAppArtifact(bytes)).rejects.toMatchObject({
      code: 'module_app_package_archive_invalid',
    });
  });

  it('rejects malformed gzip input', async () => {
    await expect(inspectModuleAppArtifact(new Uint8Array([0x1f, 0x8b, 8, 0]))).rejects.toMatchObject({
      code: 'module_app_package_archive_invalid',
    });
  });

  it(
    'rejects a gzip payload whose expanded regular files exceed the shared total limit',
    async () => {
      const file = new Uint8Array(25 * 1024 * 1024);
      const bytes = await createTgz(
        Array.from({ length: 5 }, (_, index) => ({
          bytes: file,
          name: `dist/${index}.bin`,
          type: 'file' as const,
        })),
      );

      await expect(inspectModuleAppArtifact(bytes)).rejects.toMatchObject({
        code: 'module_app_package_expanded_too_large',
      });
    },
    20_000,
  );
});
