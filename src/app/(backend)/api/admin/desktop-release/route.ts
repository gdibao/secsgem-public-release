import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DesktopBuildModel } from '@/database/models/desktopBuild';
import { getServerDB } from '@/database/server';
import { invalidateServerAppSettings } from '@/server/services/appSettings';
import {
  normalizeDesktopReleasePublication,
  writeDesktopReleasePublicationSettings,
} from '@/server/services/desktopRelease/publication';

import { isDesktopReleaseAuthorized, resolveDesktopReleaseToken } from './auth';

const DEFAULT_GITHUB_REPOSITORY = 'maheshenga/comhub';
const GITHUB_REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const bodySchema = z
  .object({
    channel: z.enum(['stable', 'canary']).default('stable'),
    downloadLabel: z.string().optional(),
    downloadUrl: z.string().optional(),
    errorSummary: z.string().max(1024).optional(),
    profileRevisionId: z.string().uuid().optional(),
    releaseId: z.string().uuid().optional(),
    releaseNotes: z.string().optional(),
    serverUrl: z.string().optional(),
    status: z.enum(['building', 'failed', 'publishing', 'queued', 'succeeded']).optional(),
    version: z.string().trim().min(1),
    workflowRunAttempt: z.number().int().positive().optional(),
    workflowRunId: z.string().trim().min(1).max(64).regex(/^\d+$/).optional(),
    workflowRunUrl: z.string().trim().max(2048).optional(),
  })
  .superRefine((input, ctx) => {
    const releaseCallback = input.releaseId !== undefined;
    if (
      releaseCallback &&
      (!input.status || (input.status !== 'failed' && !input.profileRevisionId))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'release callback is incomplete' });
    }
    if (
      releaseCallback &&
      (!input.workflowRunAttempt || !input.workflowRunId || !input.workflowRunUrl)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workflow run metadata is incomplete' });
    }
    if (
      releaseCallback &&
      input.status === 'succeeded' &&
      (!input.downloadUrl?.trim() || !input.serverUrl?.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'release publication metadata is incomplete',
      });
    }
    if (releaseCallback && input.workflowRunUrl && input.workflowRunId) {
      const repository = process.env.DESKTOP_RELEASE_GITHUB_REPOSITORY ?? DEFAULT_GITHUB_REPOSITORY;
      if (!GITHUB_REPOSITORY_PATTERN.test(repository)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GitHub repository is invalid' });
        return;
      }
      try {
        const url = new URL(input.workflowRunUrl);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'github.com' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== `/${repository}/actions/runs/${input.workflowRunId}`
        ) {
          throw new Error('invalid');
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workflowRunUrl is not allowed' });
      }
    }
  });

const getBearerToken = (request: NextRequest) =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

const releaseTransitionError = (error: unknown) =>
  error instanceof Error &&
  [
    'DESKTOP_RELEASE_INVALID_TRANSITION',
    'DESKTOP_RELEASE_REVISION_MISMATCH',
    'DESKTOP_RELEASE_TERMINAL',
    'DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH',
    'DESKTOP_RELEASE_WORKFLOW_RUN_MISMATCH',
  ].includes(error.message);

const releaseCallbackError = (error: unknown) =>
  error instanceof Error &&
  [
    'DESKTOP_RELEASE_CALLBACK_REVISION_REQUIRED',
    'DESKTOP_RELEASE_CALLBACK_WORKFLOW_REQUIRED',
    'DESKTOP_RELEASE_PUBLICATION_METADATA_INVALID',
  ].includes(error.message);

const releasePublicationNormalizationError = (error: unknown) =>
  error instanceof Error &&
  (error.message.startsWith('downloadUrl is not allowed:') ||
    error.message.startsWith('serverUrl is not allowed:'));

export const POST = async (req: NextRequest) => {
  const token = getBearerToken(req);
  const db = await getServerDB();
  let expected: null | string;
  try {
    expected = await resolveDesktopReleaseToken(db);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!expected || !isDesktopReleaseAuthorized(token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'invalid_request' },
      { status: 400 },
    );
  }

  if (!input.releaseId) {
    try {
      const publication = normalizeDesktopReleasePublication(input);
      const count = await db.transaction((tx: any) =>
        writeDesktopReleasePublicationSettings(tx, publication),
      );
      await invalidateServerAppSettings();
      return NextResponse.json({ count, ok: true });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  const model = new DesktopBuildModel(db);

  try {
    if (input.status === 'succeeded') {
      const result = await db.transaction(async (tx: any) => {
        const publication = normalizeDesktopReleasePublication(input);
        const release = await model.markReleaseCallback(
          {
            errorSummary: input.errorSummary,
            profileRevisionId: input.profileRevisionId,
            ...(publication.downloadUrl && publication.serverUrl
              ? {
                  publishedDownloadUrl: publication.downloadUrl,
                  publishedServerUrl: publication.serverUrl,
                }
              : {}),
            releaseId: input.releaseId!,
            status: input.status!,
            workflowRunAttempt: input.workflowRunAttempt!,
            workflowRunId: input.workflowRunId!,
            workflowRunUrl: input.workflowRunUrl!,
          },
          tx,
        );
        if (!release.transitionedToSucceeded) return { count: 0, updated: false };

        return {
          count: await writeDesktopReleasePublicationSettings(tx, {
            ...input,
            ...publication,
            channel: release.channel,
            releaseNotes: release.releaseNotes,
            version: release.version,
          }),
          updated: true,
        };
      });
      if (result.updated) await invalidateServerAppSettings();
      return NextResponse.json({ count: result.count, ok: true });
    }

    await db.transaction((tx: any) =>
      model.markReleaseCallback(
        {
          errorSummary: input.errorSummary,
          profileRevisionId: input.profileRevisionId,
          releaseId: input.releaseId!,
          status: input.status!,
          workflowRunAttempt: input.workflowRunAttempt!,
          workflowRunId: input.workflowRunId!,
          workflowRunUrl: input.workflowRunUrl!,
        },
        tx,
      ),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (releaseCallbackError(error) || releasePublicationNormalizationError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    if (releaseTransitionError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'DESKTOP_RELEASE_NOT_FOUND') {
      return NextResponse.json({ error: 'release_not_found' }, { status: 404 });
    }
    throw error;
  }
};
