import { createHmac } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  HeterogeneousRuntimeModel,
  HeterogeneousRuntimeOwnershipError,
} from '@/database/models/heterogeneousRuntime';
import { isPersistentHeterogeneousProvider } from '@/database/schemas';
import { authEnv } from '@/envs/auth';
import { validateHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

const SUPPORTED_HARNESSES = new Set(['codex', 'dsh', 'hermes', 'openclaw']);

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 });

/**
 * Re-authorize a server-harness run and return an opaque worker partition key.
 * The worker never receives Fab user/workspace identifiers or signing secrets.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return unauthorized();

  const claims = await validateHeteroOperationJWT(authorization.slice(7));
  if (
    !claims ||
    !claims.provider_id ||
    !SUPPORTED_HARNESSES.has(claims.provider_id) ||
    !isPersistentHeterogeneousProvider(claims.provider_id)
  ) {
    return unauthorized();
  }

  const secret = authEnv.AUTH_SECRET;
  if (!secret) {
    console.error('[Harness preflight] AUTH_SECRET is unavailable');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  try {
    const input = (await request.json().catch(() => ({}))) as {
      resumeSessionId?: unknown;
      topicId?: unknown;
    };
    if (
      input.topicId !== undefined &&
      (typeof input.topicId !== 'string' || !input.topicId.trim())
    ) {
      return NextResponse.json({ error: 'invalid_topic' }, { status: 400 });
    }
    if (
      input.resumeSessionId !== undefined &&
      (typeof input.resumeSessionId !== 'string' || !input.resumeSessionId.trim())
    ) {
      return NextResponse.json({ error: 'invalid_resume_session' }, { status: 400 });
    }
    const db = await getServerDB();
    const principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'hetero:ingest',
      claims,
      db,
      operationId: claims.operation_id,
    });
    if (
      input.topicId !== undefined &&
      (!principal.topicId || principal.topicId !== input.topicId)
    ) {
      return NextResponse.json({ error: 'operation_topic_mismatch' }, { status: 403 });
    }
    const partitionCandidate = createHmac('sha256', secret)
      .update(
        `fab-harness\0${principal.userId}\0${principal.workspaceId ?? 'personal'}\0${claims.provider_id}`,
      )
      .digest('hex');
    const runtimes = new HeterogeneousRuntimeModel(db);
    const scope = {
      provider: claims.provider_id,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    };
    const tenant = await runtimes.ensureTenant({ ...scope, partitionKey: partitionCandidate });
    if (typeof input.resumeSessionId === 'string') {
      await runtimes.assertSessionOwned(scope, input.resumeSessionId);
    }

    return NextResponse.json({
      expiresAt: claims.exp,
      credentialRef: tenant.credentialRef,
      operationId: principal.operationId,
      provider: claims.provider_id,
      runtimeRef: tenant.runtimeRef,
      runtimeStatus: tenant.status,
      tenantKey: tenant.partitionKey,
    });
  } catch (error) {
    if (error instanceof HeterogeneousRuntimeOwnershipError) {
      return NextResponse.json({ error: 'runtime_session_not_owned' }, { status: 403 });
    }
    if (error instanceof HeteroOperationPrincipalError) {
      return NextResponse.json({ error: 'operation_not_authorized' }, { status: error.status });
    }
    console.error('[Harness preflight] Failed to authorize operation', error);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
