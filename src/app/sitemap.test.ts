import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('sitemap route rendering mode', () => {
  it('does not prerender every paginated sitemap at build time', () => {
    const source = readFileSync('src/app/sitemap.tsx', 'utf8');

    expect(source).not.toMatch(/dynamic\s*=\s*['"]force-static['"]/);
    expect(source).toMatch(/dynamic\s*=\s*['"]force-dynamic['"]/);
  });
});
