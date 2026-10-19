import path from 'node:path';

import type { PipelineEntry, RepoMount } from './types';

const normalizeRepoPath = (relPath: string) => relPath.replaceAll('\\', '/');

/**
 * stylelint's CSS-in-JS parser mangles ordinary template literals in files it
 * was never configured for (it corrupted this very script once): the repos
 * scope stylelint to `{src,tests}/**` in their `lint:style` scripts, so apply
 * the same boundary here instead of lint-staged's blanket `*.{ts,tsx}` glob.
 */
export const stylelintApplies = (subPath: string) =>
  /^(?:src|tests)\//.test(normalizeRepoPath(subPath));

/**
 * Resolve a root-relative path to its owning mount and the path relative to
 * that mount. Longest mount dir prefix wins; the root mount (`dir: ''`) is the
 * fallback.
 */
export const resolveMount = (
  repos: RepoMount[],
  relPath: string,
): { mount: RepoMount; subPath: string } => {
  const normalizedRelPath = normalizeRepoPath(relPath);
  const match = repos
    .filter(
      (repo) =>
        repo.dir !== '' &&
        (normalizedRelPath === repo.dir || normalizedRelPath.startsWith(`${repo.dir}/`)),
    )
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  if (match) return { mount: match, subPath: normalizedRelPath.slice(match.dir.length + 1) };

  const root = repos.find((repo) => repo.dir === '');
  if (!root) throw new Error('CheckConfig.repos must contain a root mount (dir: "")');
  return { mount: root, subPath: normalizedRelPath };
};

/** Find the lint pipeline for a file, or null when no linter applies. */
export const pipelineFor = (pipelines: PipelineEntry[], subPath: string) => {
  const ext = path.posix.extname(normalizeRepoPath(subPath)).toLowerCase();
  return pipelines.find((entry) => entry.exts.includes(ext)) ?? null;
};

export const isTestFile = (relPath: string) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizeRepoPath(relPath));

/**
 * Related-test candidates for a source file: the file itself when it is a test,
 * otherwise sibling `<base>.test.*` and `__tests__/<base>.test.*`. Pure — the
 * caller filters candidates by on-disk existence.
 */
export const relatedTestCandidates = (relPath: string): string[] => {
  const normalizedRelPath = normalizeRepoPath(relPath);
  if (isTestFile(normalizedRelPath)) return [normalizedRelPath];
  if (!/\.[cm]?[jt]sx?$/.test(normalizedRelPath)) return [];

  const dir = path.posix.dirname(normalizedRelPath);
  const base = path.posix.basename(normalizedRelPath).replace(/\.[^.]+$/, '');
  return ['.ts', '.tsx', '.mts'].flatMap((ext) => [
    path.posix.join(dir, `${base}.test${ext}`),
    path.posix.join(dir, '__tests__', `${base}.test${ext}`),
  ]);
};

/**
 * Nearest directory (walking up to the host root) containing a vitest config —
 * the "run vitest from the owning package" rule, automated.
 */
export const findVitestConfigDir = async (
  relPath: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  const configNames = ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.mjs'];
  let dir = path.posix.dirname(normalizeRepoPath(relPath));

  while (true) {
    const candidates = configNames.map((name) => (dir === '.' ? name : path.posix.join(dir, name)));
    const found = await Promise.all(candidates.map((candidate) => exists(candidate)));
    if (found.some(Boolean)) return dir;
    if (dir === '.') return '.';
    dir = path.posix.dirname(dir);
  }
};
