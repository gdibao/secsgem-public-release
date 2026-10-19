import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileCredentialResolver } from './harness';

describe('createFileCredentialResolver', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('resolves only a referenced secret below the private root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fab-harness-credentials-'));
    roots.push(root);
    await mkdir(path.join(root, 'hermes'));
    await writeFile(path.join(root, 'hermes', 'tenant-a'), 'secret-value\n', { mode: 0o600 });

    await expect(createFileCredentialResolver(root)('file:hermes/tenant-a')).resolves.toBe(
      'secret-value',
    );
  });

  it('rejects traversal and symlinks escaping the private root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fab-harness-credentials-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'fab-harness-outside-'));
    roots.push(root, outside);
    await writeFile(path.join(outside, 'secret'), 'do-not-read', { mode: 0o600 });
    await symlink(path.join(outside, 'secret'), path.join(root, 'escaped'));
    const resolve = createFileCredentialResolver(root);

    await expect(resolve('file:../secret')).rejects.toThrow('invalid_credential_reference');
    await expect(resolve('file:escaped')).rejects.toThrow('invalid_credential_reference');
  });
});
