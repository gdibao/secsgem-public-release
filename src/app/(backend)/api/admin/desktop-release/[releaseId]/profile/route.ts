import type { DesktopBuildAssetKind } from '@lobechat/types';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DesktopBuildModel } from '@/database/models/desktopBuild';
import { getServerDB } from '@/database/server';
import { FileS3 } from '@/server/modules/S3';

import { isDesktopReleaseAuthorized, resolveDesktopReleaseToken } from '../../auth';

const ASSET_URL_TTL_SECONDS = 300;
const releaseIdSchema = z.string().uuid();
const assetKinds = ['appPreview', 'nsisHeader', 'nsisSidebar', 'windowsIcon'] as const;

const assetSchema = z
  .object({
    contentType: z.string().min(1).max(128),
    key: z.string().min(1).max(1024),
    kind: z.enum(assetKinds),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    size: z.number().int().positive(),
  })
  .passthrough();

const getBearerToken = (request: NextRequest) =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

export const GET = async (
  request: NextRequest,
  context: { params: Promise<{ releaseId: string }> },
) => {
  const { releaseId: rawReleaseId } = await context.params;
  const releaseId = releaseIdSchema.safeParse(rawReleaseId);
  if (!releaseId.success)
    return NextResponse.json({ error: 'invalid_release_id' }, { status: 400 });

  const db = await getServerDB();
  let expected: null | string;
  try {
    expected = await resolveDesktopReleaseToken(db);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!expected || !isDesktopReleaseAuthorized(getBearerToken(request), expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const model = new DesktopBuildModel(db);
  const release = await model.getRelease(releaseId.data);
  if (!release) return NextResponse.json({ error: 'release_not_found' }, { status: 404 });
  if (release.status !== 'queued' && release.status !== 'building') {
    return NextResponse.json({ error: 'release_not_available' }, { status: 409 });
  }

  const revision = await model.getRevision(release.frozenRevisionId);
  if (
    !revision ||
    revision.id !== release.frozenRevisionId ||
    revision.profileId !== release.profileId ||
    revision.state !== 'frozen'
  ) {
    return NextResponse.json({ error: 'release_revision_mismatch' }, { status: 409 });
  }

  const manifest = revision.assetManifest as Record<DesktopBuildAssetKind, unknown>;
  const assetsByKind = {} as Record<DesktopBuildAssetKind, z.infer<typeof assetSchema>>;
  for (const kind of assetKinds) {
    const result = assetSchema.safeParse(manifest[kind]);
    if (!result.success || result.data.kind !== kind) {
      return NextResponse.json({ error: 'invalid_asset_manifest' }, { status: 409 });
    }
    assetsByKind[kind] = result.data;
  }

  const storage = new FileS3();
  const assets = Object.fromEntries(
    await Promise.all(
      assetKinds.map(async (kind) => {
        const asset = assetsByKind[kind];
        return [
          kind,
          {
            contentType: asset.contentType,
            sha256: asset.sha256,
            size: asset.size,
            url: await storage.createPreSignedUrlForPreview(asset.key, ASSET_URL_TTL_SECONDS),
          },
        ];
      }),
    ),
  );

  return NextResponse.json({
    assets,
    profileRevision: {
      id: revision.id,
      payload: revision.payload,
      profileId: revision.profileId,
      revision: revision.revision,
      state: revision.state,
    },
    releaseId: release.id,
  });
};
