import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const STAGING_DIRECTORY_PATTERN = new RegExp(
  `^(${UUID_PATTERN})-(${UUID_PATTERN})$`,
  'i',
);

export const cleanupStaleModuleAppStaging = async (input: {
  artifactRoot: string;
  buildModel: {
    isClaimActive: (input: {
      buildId: string;
      claimToken: string;
    }) => Promise<boolean>;
  };
  now?: () => Date;
  remove?: (directory: string) => Promise<void>;
  staleStagingMs: number;
}): Promise<{ failed: number; removed: number }> => {
  const stagingRoot = path.join(input.artifactRoot, '.staging');
  let entries;
  try {
    entries = await readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { failed: 0, removed: 0 };
    }
    throw error;
  }

  const now = (input.now ?? (() => new Date()))().getTime();
  const remove =
    input.remove ??
    ((directory: string) => rm(directory, { force: true, recursive: true }));
  const result = { failed: 0, removed: 0 };

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory()) continue;
    const match = STAGING_DIRECTORY_PATTERN.exec(entry.name);
    if (!match) continue;

    const directory = path.join(stagingRoot, entry.name);
    try {
      const metadata = await stat(directory);
      if (now - metadata.mtimeMs <= input.staleStagingMs) continue;
      const active = await input.buildModel.isClaimActive({
        buildId: match[1]!,
        claimToken: match[2]!,
      });
      if (active) continue;
      await remove(directory);
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
};
