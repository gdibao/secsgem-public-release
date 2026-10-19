import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const workflowPath = path.resolve(__dirname, '../../.github/workflows/comhub-desktop-release.yml');
const desktopWorkspacePath = path.resolve(__dirname, '../../apps/desktop/pnpm-workspace.yaml');

describe('Chituo desktop release workflow contract', () => {
  it('builds the four desktop targets and CLI from one immutable tag', async () => {
    const document = parseDocument(await readFile(workflowPath, 'utf8'));
    const workflow = document.toJS() as any;
    const source = await readFile(workflowPath, 'utf8');

    expect(document.errors).toEqual([]);
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions.contents).toBe('write');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.jobs.prepare.steps[1].run).toContain('refs/tags/$tag');
    expect(workflow.jobs['build-desktop'].strategy['fail-fast']).toBe(false);
    expect(workflow.jobs['build-desktop'].strategy.matrix.include).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'macos-arm64', os: 'macos-15' }),
        expect.objectContaining({ id: 'macos-x64', os: 'macos-15-intel' }),
        expect.objectContaining({ id: 'windows-x64', os: 'windows-latest' }),
        expect.objectContaining({ id: 'linux-x64', os: 'ubuntu-latest' }),
      ]),
    );
    expect(workflow.jobs.release.needs).toEqual(['prepare', 'build-desktop', 'build-cli']);
    expect(source).toContain('gh release create');
    expect(source).toContain('--prerelease');
  });

  it('uses Fab defaults and never references the retired S3 publisher', async () => {
    const source = await readFile(workflowPath, 'utf8');

    expect(source).toContain('OFFICIAL_CLOUD_SERVER: https://fab.secsgem.com.cn');
    expect(source).toContain('DESKTOP_BUILD_PROFILE_PATH:');
    expect(source).toContain('NODE_OPTIONS: --max-old-space-size=16384');
    expect(source).toContain('prefer-china-mirrors: true');
    expect(source).not.toContain('desktop-publish-s3');
    expect(source).not.toContain('DESKTOP_RELEASE_S3_');
    expect(source).not.toContain('COMHUB_DESKTOP_RELEASE_TOKEN');
    expect(source).not.toContain('chat.qingyouai.com');
  });

  it('publishes only packaged assets and an explicit SHA256 manifest', async () => {
    const document = parseDocument(await readFile(workflowPath, 'utf8'));
    const workflow = document.toJS() as any;
    const releaseSteps = workflow.jobs.release.steps as Array<any>;
    const hash = releaseSteps.find((step) => step.name === 'Verify and hash release assets');
    const publish = releaseSteps.find((step) => step.name === 'Create GitHub Release');

    expect(hash.run).toContain('sha256sum');
    expect(hash.run).toContain('lobehub|comhub|qingyou');
    expect(publish.run).toContain('release-assets/*');
    expect(publish.run).toContain('--verify-tag');
  });

  it('keeps the isolated desktop workspace complete and build-script permissions explicit', async () => {
    const document = parseDocument(await readFile(desktopWorkspacePath, 'utf8'));
    const workspace = document.toJS() as any;

    expect(document.errors).toEqual([]);
    expect(workspace.packages).toContain('../../packages/module-app-build');
    expect(workspace.allowBuilds).toMatchObject({
      electron: true,
      'electron-winstaller': true,
      esbuild: true,
      'get-windows': true,
      'modern-ahocorasick': true,
      'node-mac-permissions': true,
    });
  });
});
