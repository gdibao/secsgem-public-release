import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>;
  pnpm?: { patchedDependencies?: Record<string, string> };
};
const workspace = parse(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
  patchedDependencies?: Record<string, string>;
};
const vitestConfig = readFileSync(path.join(root, 'vitest.config.mts'), 'utf8');

describe('package manager policy', () => {
  it('pins jest-dom to the supported 6.x release', () => {
    expect(manifest.devDependencies['@testing-library/jest-dom']).toBe('6.9.1');
  });

  it('does not restore the retired QStash debug patch', () => {
    expect(manifest.pnpm?.patchedDependencies ?? {}).not.toHaveProperty('@upstash/qstash');
    expect(workspace.patchedDependencies ?? {}).not.toHaveProperty('@upstash/qstash');
    expect(existsSync(path.join(root, 'patches', '@upstash__qstash.patch'))).toBe(false);
  });

  it('routes app and server tests through Vitest projects', () => {
    expect(vitestConfig).not.toContain('environmentMatchGlobs');
    expect(vitestConfig).toContain("name: 'app'");
    expect(vitestConfig).toContain("name: 'server'");
    expect(vitestConfig).toContain("include: ['apps/server/**/*.{test,spec}.?(c|m)[jt]s?(x)']");
  });
});
