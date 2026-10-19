import { describe, expect, it } from 'vitest';

import {
  buildCandidateBranch,
  extractCustomizationFilePaths,
  findTouchedCustomizations,
  parseConflictFiles,
  parseLsRemoteTags,
  renderMarkdownReport,
  selectLatestUpstreamTag,
} from './core.mjs';

describe('comhub upstream sync core', () => {
  it('selects latest stable and canary upstream tags from ls-remote output', () => {
    const tags = parseLsRemoteTags(`
1111111111111111111111111111111111111111\trefs/tags/v2.2.7
2222222222222222222222222222222222222222\trefs/tags/v2.2.9
3333333333333333333333333333333333333333\trefs/tags/v2.2.10-canary.9
4444444444444444444444444444444444444444\trefs/tags/v2.2.10-canary.14
5555555555555555555555555555555555555555\trefs/tags/v2.2.10-canary.14^{}
`);

    expect(selectLatestUpstreamTag(tags, 'stable')).toBe('v2.2.9');
    expect(selectLatestUpstreamTag(tags, 'canary')).toBe('v2.2.10-canary.14');
  });

  it('builds deterministic candidate branches from upstream refs', () => {
    expect(
      buildCandidateBranch({
        baseBranch: 'upgrade/upstream-v2.2.6-comhub-merge',
        upstreamRef: 'refs/tags/v2.2.10-canary.14',
      }),
    ).toBe('upgrade/upstream-v2.2.10-canary.14-comhub-sync');
  });

  it('parses unmerged files from porcelain status output', () => {
    const conflictFiles = parseConflictFiles(`
UU packages/model-runtime/src/index.ts
 M src/features/Brand/BrandProvider.tsx
AA "src/routes/(main)/settings/provider/index.tsx"
R  old/file.ts -> new/file.ts
`);

    expect(conflictFiles).toEqual([
      'packages/model-runtime/src/index.ts',
      'src/routes/(main)/settings/provider/index.tsx',
    ]);
  });

  it('extracts customized repository paths from the customization registry', () => {
    const paths = extractCustomizationFilePaths(`
| Area | Files | Change |
| --- | --- | --- |
| Admin providers | \`src/server/globalConfig/index.ts\`, \`packages/database/src/repositories/aiInfra/index.ts\` | Preserve DB providers |
| Deploy | \`.github/workflows/comhub-deploy.yml\`, \`docs/development/comhub-github-actions-deploy.zh-CN.md\` | Preserve deploy |
| Root | \`Dockerfile\`, \`package.json\` | Preserve runtime base |
| Note | \`not a repo path\` | ignored |
`);

    expect(paths).toEqual([
      '.github/workflows/comhub-deploy.yml',
      'Dockerfile',
      'docs/development/comhub-github-actions-deploy.zh-CN.md',
      'package.json',
      'packages/database/src/repositories/aiInfra/index.ts',
      'src/server/globalConfig/index.ts',
    ]);
  });

  it('finds upstream changes that touch customized files or descendants', () => {
    const touched = findTouchedCustomizations({
      changedFiles: [
        'src/server/globalConfig/index.ts',
        'src/features/Brand/BrandProvider.tsx',
        'packages/model-runtime/src/provider.ts',
      ],
      customizationFiles: [
        'src/server/globalConfig/index.ts',
        'src/features/Brand',
        'docs/development/comhub-github-actions-deploy.zh-CN.md',
      ],
    });

    expect(touched).toEqual([
      'src/features/Brand/BrandProvider.tsx',
      'src/server/globalConfig/index.ts',
    ]);
  });

  it('renders a report with conflicts, customization touches, and verification status', () => {
    const report = renderMarkdownReport({
      baseBranch: 'upgrade/upstream-v2.2.6-comhub-merge',
      candidateBranch: 'upgrade/upstream-v2.2.9-comhub-sync',
      changedFiles: ['src/server/globalConfig/index.ts'],
      conflictFiles: ['packages/model-runtime/src/index.ts'],
      currentVersion: '2.2.7',
      generatedAt: '2026-07-01T00:00:00.000Z',
      mergeStatus: 'conflict',
      touchedCustomizations: ['src/server/globalConfig/index.ts'],
      upstreamRef: 'v2.2.9',
      verification: [
        { command: 'git diff --check', status: 'skipped' },
        { command: 'tsgo --noEmit', status: 'skipped' },
      ],
    });

    expect(report).toContain('Result: merge conflicts');
    expect(report).toContain('packages/model-runtime/src/index.ts');
    expect(report).toContain('src/server/globalConfig/index.ts');
    expect(report).toContain('git diff --check');
  });

  it('renders no-op reports without implying a deployable candidate', () => {
    const report = renderMarkdownReport({
      baseBranch: 'upgrade/upstream-v2.2.6-comhub-merge',
      candidateBranch: 'upgrade/upstream-v2.2.9-comhub-sync',
      generatedAt: '2026-07-01T00:00:00.000Z',
      mergeStatus: 'noop',
      upstreamRef: 'v2.2.9',
    });

    expect(report).toContain('Result: no upstream changes');
  });

  it('builds a candidate branch for non-version refs without unsafe characters', () => {
    expect(
      buildCandidateBranch({
        baseBranch: 'main',
        upstreamRef: 'feature/provider runtime+pricing',
      }),
    ).toBe('upgrade/upstream-feature-provider-runtime-pricing-comhub-sync');
  });
});
