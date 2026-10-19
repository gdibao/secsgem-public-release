// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { stageDesktopBuildProfile } from './fetchDesktopBuildProfile';

const assetBytes = {
  appPreview: Buffer.from('preview'),
  nsisHeader: Buffer.from('header'),
  nsisSidebar: Buffer.from('sidebar'),
  windowsIcon: Buffer.from('icon'),
};
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const stagedDirs: string[] = [];

const profileResponse = (overrides: Record<string, unknown> = {}) => ({
  assets: Object.fromEntries(
    Object.entries(assetBytes).map(([kind, bytes]) => [
      kind,
      {
        contentType: kind === 'windowsIcon' ? 'image/x-icon' : 'image/png',
        sha256: sha256(bytes),
        size: bytes.byteLength,
        url: `https://assets.example.test/${kind}`,
      },
    ]),
  ),
  profileRevision: {
    id: '22222222-2222-4222-8222-222222222222',
    payload: { applicationId: 'com.qingyou.comhub' },
    state: 'frozen',
  },
  releaseId: '11111111-1111-4111-8111-111111111111',
  ...overrides,
});

const fetcherFor = (profile: Record<string, any>, responses = new Map<string, Response>()) =>
  vi.fn(async (input: URL | RequestInfo) => {
    const url = input.toString();
    if (url.includes('/profile')) return new Response(JSON.stringify(profile), { status: 200 });
    return (
      responses.get(url) ??
      new Response(assetBytes[url.split('/').at(-1)! as keyof typeof assetBytes])
    );
  }) as typeof fetch;

const createOutputDir = async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'desktop-profile-test-'));
  stagedDirs.push(outputDir);
  return outputDir;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stagedDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('stageDesktopBuildProfile', () => {
  it('stages verified assets at fixed absolute paths after a controlled redirect', async () => {
    const outputDir = await createOutputDir();
    const responses = new Map<string, Response>([
      [
        'https://assets.example.test/appPreview',
        new Response(null, { headers: { location: '/appPreview-final' }, status: 302 }),
      ],
      ['https://assets.example.test/appPreview-final', new Response(assetBytes.appPreview)],
    ]);

    const result = await stageDesktopBuildProfile({
      appUrl: 'https://chat.qingyouai.com/',
      fetcher: fetcherFor(profileResponse(), responses),
      outputDir,
      releaseId: '11111111-1111-4111-8111-111111111111',
      token: 'release-token',
    });
    const staged = JSON.parse(await readFile(result, 'utf8'));

    expect(path.isAbsolute(result)).toBe(true);
    expect(staged).toMatchObject({
      profile: { applicationId: 'com.qingyou.comhub' },
      profileRevisionId: '22222222-2222-4222-8222-222222222222',
      releaseId: '11111111-1111-4111-8111-111111111111',
    });
    expect(Object.values(staged.assets).every((file) => path.isAbsolute(file as string))).toBe(
      true,
    );
    await expect(readFile(staged.assets.windowsIcon)).resolves.toEqual(assetBytes.windowsIcon);
  });

  it('cancels a chunked redirect body before following its allowed location', async () => {
    const outputDir = await createOutputDir();
    let cancellationCompleted = false;
    const redirectBody = new ReadableStream({
      cancel: async () => {
        await Promise.resolve();
        cancellationCompleted = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const responses = new Map<string, Response>([
      [
        'https://assets.example.test/appPreview',
        new Response(redirectBody, { headers: { location: '/appPreview-final' }, status: 302 }),
      ],
      ['https://assets.example.test/appPreview-final', new Response(assetBytes.appPreview)],
    ]);
    const fetcher = fetcherFor(profileResponse(), responses);

    await stageDesktopBuildProfile({
      appUrl: 'https://chat.qingyouai.com/',
      fetcher: (async (input, init) => {
        if (input.toString().endsWith('/appPreview-final'))
          expect(cancellationCompleted).toBe(true);
        return fetcher(input, init);
      }) as typeof fetch,
      outputDir,
      releaseId: '11111111-1111-4111-8111-111111111111',
      token: 'release-token',
    });

    expect(cancellationCompleted).toBe(true);
  });

  it('cancels a redirect body before rejecting a missing location', async () => {
    const outputDir = await createOutputDir();
    let cancellationCompleted = false;
    const redirectBody = new ReadableStream({
      cancel: async () => {
        await Promise.resolve();
        cancellationCompleted = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const responses = new Map<string, Response>([
      ['https://assets.example.test/appPreview', new Response(redirectBody, { status: 302 })],
    ]);

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com/',
        fetcher: fetcherFor(profileResponse(), responses),
        outputDir,
        releaseId: '11111111-1111-4111-8111-111111111111',
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_REDIRECT_INVALID');

    expect(cancellationCompleted).toBe(true);
  });

  it('cancels every redirect body before rejecting exhausted redirects', async () => {
    const outputDir = await createOutputDir();
    let cancellations = 0;
    const redirectResponse = (location: string) =>
      new Response(
        new ReadableStream({
          cancel: async () => {
            await Promise.resolve();
            cancellations++;
          },
          start(controller) {
            controller.enqueue(new Uint8Array(1024));
          },
        }),
        { headers: { location }, status: 302 },
      );
    const responses = new Map<string, Response>([
      ['https://assets.example.test/appPreview', redirectResponse('/redirect-1')],
      ['https://assets.example.test/redirect-1', redirectResponse('/redirect-2')],
      ['https://assets.example.test/redirect-2', redirectResponse('/redirect-3')],
      ['https://assets.example.test/redirect-3', redirectResponse('/redirect-4')],
    ]);

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com/',
        fetcher: fetcherFor(profileResponse(), responses),
        outputDir,
        releaseId: '11111111-1111-4111-8111-111111111111',
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_REDIRECT_INVALID');

    expect(cancellations).toBe(4);
  });

  it('removes prior staged assets and profile output when a later asset checksum fails', async () => {
    const outputDir = await createOutputDir();
    const profile = profileResponse();
    profile.assets.nsisHeader.sha256 = '0'.repeat(64);

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com',
        fetcher: fetcherFor(profile),
        outputDir,
        releaseId: profile.releaseId,
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_CHECKSUM_MISMATCH');
    await expect(readFile(path.join(outputDir, 'app-preview.png'))).rejects.toThrow();
    await expect(readFile(path.join(outputDir, 'nsis-header.bmp'))).rejects.toThrow();
    await expect(readFile(path.join(outputDir, 'desktop-build-profile.json'))).rejects.toThrow();
  });

  it('bounds oversized chunked asset streams and cleans prior staged output', async () => {
    const outputDir = await createOutputDir();
    const profile = profileResponse();
    profile.assets.nsisHeader.size = 1;
    let cancellationCompleted = false;
    const oversizedBody = new ReadableStream({
      cancel: async () => {
        await Promise.resolve();
        cancellationCompleted = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    const responses = new Map<string, Response>([
      ['https://assets.example.test/nsisHeader', new Response(oversizedBody)],
    ]);

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com',
        fetcher: fetcherFor(profile, responses),
        outputDir,
        releaseId: profile.releaseId,
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_TOO_LARGE');

    expect(cancellationCompleted).toBe(true);
    await expect(readFile(path.join(outputDir, 'app-preview.png'))).rejects.toThrow();
    await expect(readFile(path.join(outputDir, 'nsis-header.bmp'))).rejects.toThrow();
    await expect(readFile(path.join(outputDir, 'desktop-build-profile.json'))).rejects.toThrow();
  });

  it('rejects oversized content-length values before streaming the response', async () => {
    const outputDir = await createOutputDir();
    const profile = profileResponse();
    profile.assets.appPreview.size = 1;
    const responses = new Map<string, Response>([
      [
        'https://assets.example.test/appPreview',
        new Response(assetBytes.appPreview, { headers: { 'content-length': '999999999' } }),
      ],
    ]);

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com',
        fetcher: fetcherFor(profile, responses),
        outputDir,
        releaseId: profile.releaseId,
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_TOO_LARGE');
  });

  it('rejects profiles missing a required asset', async () => {
    const outputDir = await createOutputDir();
    const profile = profileResponse();
    delete profile.assets.nsisSidebar;

    await expect(
      stageDesktopBuildProfile({
        appUrl: 'https://chat.qingyouai.com',
        fetcher: fetcherFor(profile),
        outputDir,
        releaseId: profile.releaseId,
        token: 'release-token',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_PROFILE_ASSET_MISSING');
  });
});
