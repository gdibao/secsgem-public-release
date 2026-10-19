#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildCandidateBranch,
  extractCustomizationFilePaths,
  findTouchedCustomizations,
  parseConflictFiles,
  parseLsRemoteTags,
  renderMarkdownReport,
  selectLatestUpstreamTag,
} from './core.mjs';

const DEFAULT_UPSTREAM_URL = 'https://github.com/lobehub/lobehub.git';
const DEFAULT_BASE_BRANCH = 'upgrade/upstream-v2.2.6-comhub-merge';
const DEFAULT_REPORT_DIR = 'docs/development/upstream-sync-reports';
const DEFAULT_CUSTOMIZATION_REGISTRY = 'docs/development/comhub-upstream-customizations.md';

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const baseBranch = options.baseBranch || env('COMHUB_UPSTREAM_BASE_BRANCH') || DEFAULT_BASE_BRANCH;
  const upstreamUrl =
    options.upstreamUrl || env('COMHUB_UPSTREAM_URL') || env('UPSTREAM_URL') || DEFAULT_UPSTREAM_URL;
  const channel = options.channel || env('COMHUB_UPSTREAM_CHANNEL') || 'stable';
  const shouldPush = options.push || env('COMHUB_UPSTREAM_PUSH') === 'true';
  const shouldVerify = options.verify !== false;
  const allowDirty = options.allowDirty || env('COMHUB_UPSTREAM_ALLOW_DIRTY') === 'true';
  const shouldFetch = options.fetch !== false;

  ensureCleanWorktree({ allowDirty });
  if (shouldFetch) ensureRemote('upstream', upstreamUrl);

  const upstreamRef = resolveUpstreamRef({ channel, explicitRef: options.upstreamRef, upstreamUrl });
  const candidateBranch =
    options.candidateBranch ||
    env('COMHUB_UPSTREAM_CANDIDATE_BRANCH') ||
    buildCandidateBranch({ baseBranch, upstreamRef });
  const reportPath = path.resolve(
    root,
    options.reportPath ||
      env('COMHUB_UPSTREAM_REPORT_PATH') ||
      path.join(DEFAULT_REPORT_DIR, `${candidateBranch.replaceAll('/', '-')}.md`),
  );

  console.log(`Base branch: ${baseBranch}`);
  console.log(`Upstream URL: ${upstreamUrl}`);
  console.log(`Upstream ref: ${upstreamRef}`);
  console.log(`Candidate branch: ${candidateBranch}`);

  checkoutCandidateBranch({ baseBranch, candidateBranch });

  const changedFiles = getChangedFiles(upstreamRef);
  const isNoop = isSameCommit('HEAD', upstreamRef);
  const customizationFiles = loadCustomizationFiles(root);
  const touchedCustomizations = findTouchedCustomizations({ changedFiles, customizationFiles });
  ensureGitIdentity();
  const mergeResult = isNoop ? { status: 'noop' } : mergeUpstream(upstreamRef);
  const conflictFiles = mergeResult.status === 'conflict' ? parseConflictFiles(git(['status', '--porcelain'])) : [];
  const verification =
    mergeResult.status === 'clean' && shouldVerify ? runVerificationCommands() : skippedVerification();

  writeReport(reportPath, {
    baseBranch,
    candidateBranch,
    changedFiles,
    conflictFiles,
    currentVersion: readPackageVersion(root),
    generatedAt: new Date().toISOString(),
    mergeStatus: mergeResult.status,
    touchedCustomizations,
    upstreamRef,
    verification,
  });

  writeGitHubOutputs({
    candidate_branch: candidateBranch,
    changed_file_count: String(changedFiles.length),
    conflict_count: String(conflictFiles.length),
    merge_status: mergeResult.status,
    report_path: toPosixRelative(root, reportPath),
    touched_customization_count: String(touchedCustomizations.length),
    upstream_ref: upstreamRef,
  });

  if (mergeResult.status !== 'clean') {
    console.error(`Upstream merge stopped with status: ${mergeResult.status}`);
    process.exitCode = mergeResult.status === 'noop' ? 0 : 2;
    return;
  }

  const failedVerification = verification.find((item) => item.status === 'failed');
  if (failedVerification) {
    console.error(`Verification failed: ${failedVerification.command}`);
    process.exitCode = 3;
    return;
  }

  commitReportIfNeeded({ reportPath, root, upstreamRef });

  if (shouldPush) {
    git(['push', '--force-with-lease', 'origin', `HEAD:${candidateBranch}`], { stdio: 'inherit' });
  }
};

const parseArgs = (args) => {
  const options = { verify: true };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      index++;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);

      return args[index];
    };

    if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--base-branch') options.baseBranch = next();
    else if (arg === '--candidate-branch') options.candidateBranch = next();
    else if (arg === '--channel') options.channel = next();
    else if (arg === '--skip-fetch') options.fetch = false;
    else if (arg === '--no-verify') options.verify = false;
    else if (arg === '--push') options.push = true;
    else if (arg === '--report-path') options.reportPath = next();
    else if (arg === '--upstream-ref') options.upstreamRef = next();
    else if (arg === '--upstream-url') options.upstreamUrl = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const env = (name) => {
  const value = process.env[name];

  return value && value.trim() ? value.trim() : undefined;
};

const ensureCleanWorktree = ({ allowDirty }) => {
  const status = git(['status', '--porcelain']);
  if (allowDirty || !status.trim()) return;

  throw new Error(
    'Working tree is not clean. Commit/stash local changes first, or run with --allow-dirty in a disposable checkout.',
  );
};

const ensureRemote = (name, url) => {
  const remotes = git(['remote']).split(/\r?\n/);
  if (remotes.includes(name)) {
    git(['remote', 'set-url', name, url]);
  } else {
    git(['remote', 'add', name, url]);
  }

  git(['fetch', '--tags', '--prune', name], { stdio: 'inherit' });
};

const resolveUpstreamRef = ({ channel, explicitRef, upstreamUrl }) => {
  if (explicitRef) return explicitRef;

  const tagOutput = git(['ls-remote', '--tags', upstreamUrl]);
  const tags = parseLsRemoteTags(tagOutput);

  return selectLatestUpstreamTag(tags, channel);
};

const checkoutCandidateBranch = ({ baseBranch, candidateBranch }) => {
  const baseRef = resolveBaseRef(baseBranch);

  git(['switch', '--force-create', candidateBranch, baseRef], { stdio: 'inherit' });
};

const resolveBaseRef = (baseBranch) => {
  const candidates = [`origin/${baseBranch}`, baseBranch, 'HEAD'];

  for (const candidate of candidates) {
    const result = spawnSync('git', ['rev-parse', '--verify', candidate], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0) return candidate;
  }

  return 'HEAD';
};

const getChangedFiles = (upstreamRef) =>
  uniqueSorted(
    git(['diff', '--name-only', '--diff-filter=ACMRTUXB', `HEAD...${upstreamRef}`])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

const isSameCommit = (leftRef, rightRef) => {
  const left = git(['rev-parse', leftRef]).trim();
  const right = git(['rev-parse', rightRef]).trim();

  return left === right;
};

const loadCustomizationFiles = (root) => {
  const registryPath = path.resolve(root, DEFAULT_CUSTOMIZATION_REGISTRY);
  if (!existsSync(registryPath)) return [];

  return extractCustomizationFilePaths(readFileSync(registryPath, 'utf8'));
};

const mergeUpstream = (upstreamRef) => {
  const result = spawnSync('git', ['merge', '--no-ff', '--no-edit', upstreamRef], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);

    return { status: 'clean' };
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  const status = git(['status', '--porcelain']);
  const conflictFiles = parseConflictFiles(status);

  return { status: conflictFiles.length > 0 ? 'conflict' : 'failed' };
};

const runVerificationCommands = () => {
  const commands = [
    'git diff --check HEAD^1..HEAD',
    'node ./node_modules/vitest/vitest.mjs run --silent=passed-only scripts/comhub-upstream-sync/core.test.ts',
    `${process.platform === 'win32' ? '.\\node_modules\\.bin\\tsgo.cmd' : './node_modules/.bin/tsgo'} --noEmit`,
  ];

  return commands.map(runShellCommand);
};

const skippedVerification = () =>
  ['git diff --check', 'scripts/comhub-upstream-sync/core.test.ts', 'tsgo --noEmit'].map(
    (command) => ({
      command,
      status: 'skipped',
    }),
  );

const runShellCommand = (command) => {
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    command,
    exitCode: result.status ?? 1,
    status: result.status === 0 ? 'passed' : 'failed',
  };
};

const writeReport = (reportPath, report) => {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdownReport(report));
  console.log(`Report written: ${reportPath}`);
};

const commitReportIfNeeded = ({ reportPath, root, upstreamRef }) => {
  git(['add', '--', toPosixRelative(root, reportPath)]);

  const diffResult = spawnSync('git', ['diff', '--cached', '--quiet', '--', toPosixRelative(root, reportPath)], {
    stdio: 'ignore',
  });
  if (diffResult.status === 0) return;

  git(['commit', '-m', `chore: add upstream sync report for ${upstreamRef}`], { stdio: 'inherit' });
};

const ensureGitIdentity = () => {
  const hasUserName = spawnSync('git', ['config', 'user.name'], { stdio: 'ignore' }).status === 0;
  const hasUserEmail = spawnSync('git', ['config', 'user.email'], { stdio: 'ignore' }).status === 0;

  if (!hasUserName) git(['config', 'user.name', 'github-actions[bot]']);
  if (!hasUserEmail) git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
};

const readPackageVersion = (root) => {
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));

    return packageJson.version;
  } catch {
    return undefined;
  }
};

const writeGitHubOutputs = (outputs) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const payload = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(outputPath, `${payload}\n`, { flag: 'a' });
};

const toPosixRelative = (root, filePath) => path.relative(root, filePath).replaceAll('\\', '/');

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

const git = (args, options = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });

main();
