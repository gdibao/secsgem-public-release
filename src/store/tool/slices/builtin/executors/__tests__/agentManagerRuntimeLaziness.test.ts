import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../../../..');

const readSource = (filePath: string) => readFileSync(path.resolve(ROOT, filePath), 'utf8');

describe('agent manager runtime executor modules', () => {
  it('does not instantiate AgentManagerRuntime while executor modules are loading', () => {
    const files = [
      'packages/builtin-tool-agent-builder/src/executor.ts',
      'packages/builtin-tool-agent-management/src/executor.ts',
      'packages/builtin-tool-group-agent-builder/src/executor.ts',
    ];

    for (const file of files) {
      expect(readSource(file), file).not.toMatch(
        /const\s+\w+\s*=\s*new\s+AgentManagerRuntime\s*\(/,
      );
    }
  });
});

describe('user data store registry', () => {
  it('does not capture Zustand store instances while the registry module is loading', () => {
    expect(readSource('src/store/utils/userDataStores.ts')).not.toMatch(
      /const\s+resetableStores\s*:\s*ResetableStoreApi\[\]\s*=\s*\[/,
    );
  });

  it('does not statically import resettable Zustand stores', () => {
    expect(readSource('src/store/utils/userDataStores.ts')).not.toMatch(
      /^import\s+\{\s*use\w+Store\s*\}\s+from\s+['"]@\/store\//m,
    );
  });

  it('awaits async user data resets before refreshing dependent stores', () => {
    const syncSource = readSource('src/store/electron/actions/sync.ts');
    const resetLines = syncSource
      .split('\n')
      .filter((line) => line.includes('stores.reset();'))
      .map((line) => line.trim());

    expect(resetLines.length).toBeGreaterThan(0);
    expect(resetLines.every((line) => line.startsWith('await '))).toBe(true);
  });
});
