import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { toNextJsHandler } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { createAdminCommand } from '@/business/server/lambda-routers/admin/adminCommand';
import { recordAdminAuditStrict } from '@/business/server/lambda-routers/admin/audit';
import { getServerDB } from '@/database/core/db-adaptor';
import { users } from '@/database/schemas';
import { extractClientIp } from '@/libs/trpc/utils/clientIp';

const jsonContentTypeRegex = /^application\/(?:[a-z0-9.+-]*\+)?json/i;

const handler = toNextJsHandler(auth);
const impersonationCommand = createAdminCommand('user.impersonate.attempt');
const impersonationBoundary = impersonationCommand.definition.serverBoundary;
const impersonationBodySchema = z.object({ userId: z.string().min(1) });

const malformedJsonResponse = () =>
  Response.json({ code: 'INVALID_JSON', message: 'Malformed JSON request body' }, { status: 400 });

/**
 * better-call currently treats Request.json() SyntaxError as a server error.
 * Validate JSON bodies at the route boundary so malformed client payloads stay 400s.
 */
const validateJsonBody = async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  if (!request.body || !jsonContentTypeRegex.test(contentType)) return;

  try {
    await request.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) return malformedJsonResponse();
    throw error;
  }
};

const commandErrorResponse = (error: unknown) => {
  if (!(error instanceof TRPCError)) throw error;
  if (error.code !== 'BAD_REQUEST' && error.code !== 'FORBIDDEN') throw error;

  return Response.json(
    { code: error.message, message: error.message },
    { status: error.code === 'FORBIDDEN' ? 403 : 400 },
  );
};

const routeErrorResponse = (code: string, status: number) =>
  Response.json({ code, message: code }, { status });
const normalizeRoutePath = (path: string) => path.replace(/\/+$/, '') || '/';

const handleImpersonation = async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return routeErrorResponse('ADMIN_COMMAND_REQUIRED', 400);
  }

  const commandValue =
    body && typeof body === 'object' ? (body as Record<string, unknown>).command : undefined;
  let command;
  try {
    command = impersonationCommand.validate(commandValue);
  } catch (error) {
    return commandErrorResponse(error);
  }

  const parsedBody = impersonationBodySchema.safeParse(body);
  if (!parsedBody.success) return routeErrorResponse('IMPERSONATION_TARGET_REQUIRED', 400);

  const session = await auth.api.getSession({ headers: request.headers });
  const actorUserId = session?.user?.id;
  if (!actorUserId) return routeErrorResponse('UNAUTHORIZED', 401);
  if (actorUserId === parsedBody.data.userId) {
    return routeErrorResponse('CANNOT_IMPERSONATE_SELF', 400);
  }

  const db = await getServerDB();
  const actor = await db.query.users.findFirst({
    columns: { banned: true, role: true },
    where: eq(users.id, actorUserId),
  });
  if (actor?.banned || !hasAdminCapability(actor?.role, ADMIN_CAPABILITIES.adminAccess)) {
    return routeErrorResponse('FORBIDDEN', 403);
  }

  const target = await db.query.users.findFirst({
    columns: { email: true, fullName: true, id: true, username: true },
    where: eq(users.id, parsedBody.data.userId),
  });
  if (!target) return routeErrorResponse('USER_NOT_FOUND', 404);

  await recordAdminAuditStrict(
    {
      clientIp: extractClientIp(request.headers),
      serverDB: db,
      userId: actorUserId,
    },
    {
      action: command.auditAction,
      payload: {
        targetEmail: target.email,
        targetFullName: target.fullName,
        targetUsername: target.username,
      },
      resourceType: 'user',
      targetUserId: target.id,
    },
  );

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const betterAuthRequest = new Request(request.url, {
    body: JSON.stringify({ userId: target.id }),
    headers,
    method: request.method,
    signal: request.signal,
  }) as NextRequest;

  return handler.POST(betterAuthRequest);
};

export const GET = handler.GET;

export const POST = async (request: NextRequest) => {
  const invalidJsonResponse = await validateJsonBody(request);
  if (invalidJsonResponse) return invalidJsonResponse;

  if (
    impersonationBoundary.kind === 'http' &&
    request.method === impersonationBoundary.method &&
    normalizeRoutePath(new URL(request.url).pathname) === impersonationBoundary.path
  ) {
    return handleImpersonation(request);
  }

  return handler.POST(request);
};
