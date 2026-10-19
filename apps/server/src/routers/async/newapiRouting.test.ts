import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const normalizeWhitespace = (source: string) => source.replaceAll(/\s+/g, ' ');
const currentDir = dirname(fileURLToPath(import.meta.url));
const expectRuntimeInitWithModelMetadata = (
  source: string,
  modelType: 'image' | 'video',
) => {
  expect(source).toMatch(
    new RegExp(
      `initModelRuntimeFromDB\\(ctx\\.serverDB, ctx\\.userId, provider, \\{[^}]*model: resolvedModelId,[^}]*modelType: '${modelType}',`,
    ),
  );
};

describe('async generation NewAPI routing', () => {
  it('passes resolved image model metadata into runtime initialization', async () => {
    const source = normalizeWhitespace(
      await readFile(join(currentDir, 'image.ts'), 'utf8'),
    );

    expectRuntimeInitWithModelMetadata(source, 'image');
  });

  it('passes resolved video model metadata into runtime initialization', async () => {
    const source = normalizeWhitespace(
      await readFile(join(currentDir, 'video.ts'), 'utf8'),
    );

    expectRuntimeInitWithModelMetadata(source, 'video');
  });
});
