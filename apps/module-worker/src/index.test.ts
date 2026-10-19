import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('module worker bootstrap', () => {
  it('registers OpenTelemetry before dynamically loading database and HTTP clients', async () => {
    const repositoryRoot = process.cwd().endsWith(path.join('apps', 'module-worker'))
      ? path.resolve(process.cwd(), '..', '..')
      : process.cwd();
    const source = await readFile(
      path.join(repositoryRoot, 'apps', 'module-worker', 'src', 'index.ts'),
      'utf8',
    );
    const registerAt = source.indexOf("register({ name: 'comhub-module-worker' })");
    const databaseAt = source.indexOf("import('./database')");
    const storageAt = source.indexOf("import('./s3')");

    expect(registerAt).toBeGreaterThan(-1);
    expect(databaseAt).toBeGreaterThan(registerAt);
    expect(storageAt).toBeGreaterThan(registerAt);
    expect(source).not.toMatch(/import .* from ['"]\.\/database['"]/);
    expect(source).not.toMatch(/import .* from ['"]\.\/s3['"]/);
  });
});
