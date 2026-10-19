import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { HeterogeneousRuntimeModel } from '@/database/models/heterogeneousRuntime';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { gatewayEnv } from '@/envs/gateway';

const PROVIDERS = ['codex', 'dsh', 'openclaw', 'hermes'] as const;

/** Expose availability only; worker addresses and credentials remain server-side. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const enabled = Boolean(gatewayEnv.AGENT_HARNESS_GATEWAY_URL);
  if (!enabled) return NextResponse.json({ enabled: false, providers: [] });

  const workspaceId = new URL(request.url).searchParams.get('workspaceId')?.trim() || undefined;
  const db = await getServerDB();
  if (workspaceId) {
    const member = await new WorkspaceMemberModel(db, session.user.id).getMember(
      workspaceId,
      session.user.id,
    );
    if (!member) return NextResponse.json({ error: 'workspace_forbidden' }, { status: 403 });
  }

  const disabled = new Set(
    (gatewayEnv.AGENT_HARNESS_DISABLED_PROVIDERS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const runtimes = new HeterogeneousRuntimeModel(db);
  const tenantByProvider = new Map(
    await Promise.all(
      (['openclaw', 'hermes'] as const).map(
        async (provider) =>
          [
            provider,
            await runtimes.findTenant({ provider, userId: session.user.id, workspaceId }),
          ] as const,
      ),
    ),
  );

  return NextResponse.json({
    enabled,
    providers: PROVIDERS.map((type) => {
      if (disabled.has(type)) return { available: false, reason: 'disabled_by_admin', type };
      if (type === 'codex' || type === 'dsh') return { available: true, type };

      const tenant = tenantByProvider.get(type);
      const ready = tenant?.status === 'ready' && Boolean(tenant.runtimeRef);
      const hasCredential = type !== 'hermes' || Boolean(tenant?.credentialRef);
      return {
        available: ready && hasCredential,
        ...(!ready || !hasCredential ? { reason: 'tenant_not_ready' } : undefined),
        type,
      };
    }),
  });
}
