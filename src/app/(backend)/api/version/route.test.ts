import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, getVersionMetadata } from './route';

describe('/api/version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('normalizes safe ComHub deployment metadata', () => {
    expect(
      getVersionMetadata({
        COMHUB_BUILD_AT: ' 2026-07-07T01:02:03Z ',
        COMHUB_BUILD_BRANCH: ' feat/p1-commercial-ai-admin-hardening ',
        COMHUB_COMMIT_SHA: 'abcdef1234567890',
        COMHUB_IMAGE_REF: 'ghcr.io/example/comhub:sha-abcdef123456',
        COMHUB_IMAGE_TAG: 'sha-abcdef123456',
      }),
    ).toEqual({
      branch: 'feat/p1-commercial-ai-admin-hardening',
      buildAt: '2026-07-07T01:02:03Z',
      commitSha: 'abcdef1234567890',
      commitShortSha: 'abcdef123456',
      deploymentId: null,
      imageRef: 'ghcr.io/example/comhub:sha-abcdef123456',
      imageTag: 'sha-abcdef123456',
    });
  });

  it('falls back to GitHub and Vercel metadata names', () => {
    expect(
      getVersionMetadata({
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: '1234567890abcdef',
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
      }),
    ).toMatchObject({
      branch: 'main',
      commitSha: '1234567890abcdef',
      commitShortSha: '1234567890ab',
      deploymentId: 'dpl_123',
    });
  });

  it('returns package version with deployment metadata from GET', async () => {
    vi.stubEnv('COMHUB_COMMIT_SHA', 'fedcba9876543210');
    vi.stubEnv('COMHUB_BUILD_BRANCH', 'canary');
    vi.stubEnv('COMHUB_IMAGE_TAG', 'sha-fedcba987654');

    const response = await GET();
    const data = await response.json();

    expect(data).toMatchObject({
      branch: 'canary',
      commitSha: 'fedcba9876543210',
      commitShortSha: 'fedcba987654',
      imageTag: 'sha-fedcba987654',
      version: expect.any(String),
    });
  });
});
