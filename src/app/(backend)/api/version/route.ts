import { NextResponse } from 'next/server';

import pkg from '../../../../../package.json';

export interface VersionResponseData {
  branch: null | string;
  buildAt: null | string;
  commitSha: null | string;
  commitShortSha: null | string;
  deploymentId: null | string;
  imageRef: null | string;
  imageTag: null | string;
  version: string;
}

type MetadataEnv = Record<string, string | undefined>;

const clean = (value: string | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const getVersionMetadata = (env: MetadataEnv = process.env) => {
  const commitSha =
    clean(env.COMHUB_COMMIT_SHA) ||
    clean(env.GITHUB_SHA) ||
    clean(env.VERCEL_GIT_COMMIT_SHA) ||
    clean(env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);

  return {
    branch:
      clean(env.COMHUB_BUILD_BRANCH) ||
      clean(env.GITHUB_REF_NAME) ||
      clean(env.VERCEL_GIT_COMMIT_REF),
    buildAt: clean(env.COMHUB_BUILD_AT),
    commitSha,
    commitShortSha: commitSha ? commitSha.slice(0, 12) : null,
    deploymentId: clean(env.COMHUB_DEPLOYMENT_ID) || clean(env.VERCEL_DEPLOYMENT_ID),
    imageRef: clean(env.COMHUB_IMAGE_REF),
    imageTag: clean(env.COMHUB_IMAGE_TAG),
  };
};

export async function GET() {
  return NextResponse.json({
    ...getVersionMetadata(),
    version: pkg.version,
  } satisfies VersionResponseData);
}
