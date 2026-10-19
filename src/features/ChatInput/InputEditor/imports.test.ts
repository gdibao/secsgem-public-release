import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('InputEditor imports', () => {
  it('does not import FloatMenu from the editor public react entry', () => {
    const source = readFileSync('src/features/ChatInput/InputEditor/index.tsx', 'utf8');

    expect(source).not.toMatch(
      /import\s*\{[^}]*\bFloatMenu\b[^}]*\}\s*from\s*['"]@lobehub\/editor\/react['"]/,
    );
  });
});
