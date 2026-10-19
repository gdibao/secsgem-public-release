// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  heterogeneousRuntimeSessions,
  heterogeneousRuntimeTenants,
} from '../../schemas/heterogeneousRuntime';
import type { LobeChatDatabase } from '../../type';
import {
  HeterogeneousRuntimeModel,
  HeterogeneousRuntimeOwnershipError,
} from '../heterogeneousRuntime';

const client = new PGlite();
const db = drizzle({
  client,
  schema: { heterogeneousRuntimeSessions, heterogeneousRuntimeTenants },
}) as unknown as LobeChatDatabase;
const model = new HeterogeneousRuntimeModel(db);
const userA = 'hetero-runtime-user-a';
const userB = 'hetero-runtime-user-b';
const workspaceA = 'hetero-runtime-workspace-a';
const workspaceB = 'hetero-runtime-workspace-b';

beforeAll(async () => {
  await client.exec(`
    CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL);
    CREATE TABLE "workspaces" (
      "id" text PRIMARY KEY NOT NULL,
      "slug" varchar(100) NOT NULL UNIQUE,
      "name" varchar(255) NOT NULL,
      "primary_owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
    );
    CREATE TABLE "topics" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "workspace_id" text REFERENCES "workspaces"("id") ON DELETE CASCADE
    );
    CREATE TABLE "heterogeneous_runtime_tenants" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "workspace_id" text REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "provider" varchar(32) NOT NULL,
      "partition_key" text NOT NULL UNIQUE,
      "runtime_ref" text,
      "workspace_ref" text NOT NULL,
      "state_ref" text NOT NULL,
      "credential_ref" text,
      "status" varchar(32) DEFAULT 'provisioning' NOT NULL,
      "metadata" jsonb DEFAULT '{}'::jsonb,
      "accessed_at" timestamptz DEFAULT now() NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX "heterogeneous_runtime_tenants_personal_unique"
      ON "heterogeneous_runtime_tenants" ("user_id", "provider") WHERE "workspace_id" IS NULL;
    CREATE UNIQUE INDEX "heterogeneous_runtime_tenants_workspace_unique"
      ON "heterogeneous_runtime_tenants" ("user_id", "workspace_id", "provider") WHERE "workspace_id" IS NOT NULL;
    CREATE TABLE "heterogeneous_runtime_sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "tenant_id" uuid NOT NULL REFERENCES "heterogeneous_runtime_tenants"("id") ON DELETE CASCADE,
      "topic_id" text REFERENCES "topics"("id") ON DELETE SET NULL,
      "native_session_id" text NOT NULL,
      "native_thread_id" text,
      "status" varchar(32) DEFAULT 'active' NOT NULL,
      "metadata" jsonb DEFAULT '{}'::jsonb,
      "accessed_at" timestamptz DEFAULT now() NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      UNIQUE ("tenant_id", "native_session_id")
    );
  `);
  await client.exec(`
    INSERT INTO "users" ("id") VALUES ('${userA}'), ('${userB}');
    INSERT INTO "workspaces" ("id", "slug", "name", "primary_owner_id") VALUES
      ('${workspaceA}', '${workspaceA}', 'Runtime A', '${userA}'),
      ('${workspaceB}', '${workspaceB}', 'Runtime B', '${userB}');
    INSERT INTO "topics" ("id", "user_id", "workspace_id") VALUES
      ('hetero-topic-a', '${userA}', '${workspaceA}'),
      ('hetero-topic-b', '${userB}', '${workspaceB}');
  `);
});

afterAll(async () => {
  await db.delete(heterogeneousRuntimeSessions);
  await db.delete(heterogeneousRuntimeTenants);
  await client.close();
});

describe('HeterogeneousRuntimeModel', () => {
  it('keeps one durable tenant identity across service restarts', async () => {
    const scope = { provider: 'codex' as const, userId: userA, workspaceId: workspaceA };
    const first = await model.ensureTenant({ ...scope, partitionKey: 'a'.repeat(64) });
    const afterRestart = await new HeterogeneousRuntimeModel(db).ensureTenant({
      ...scope,
      partitionKey: 'b'.repeat(64),
    });

    expect(afterRestart.id).toBe(first.id);
    expect(afterRestart.partitionKey).toBe('a'.repeat(64));
    expect(afterRestart.workspaceRef).toContain(first.partitionKey);
  });

  it('rejects cross-user and cross-workspace native session access', async () => {
    const scopeA = { provider: 'codex' as const, userId: userA, workspaceId: workspaceA };
    await model.bindSession({
      ...scopeA,
      nativeSessionId: 'codex-thread-a',
      nativeThreadId: 'codex-thread-a',
      topicId: 'hetero-topic-a',
    });

    await expect(
      model.assertSessionOwned(
        { provider: 'codex', userId: userB, workspaceId: workspaceB },
        'codex-thread-a',
      ),
    ).rejects.toBeInstanceOf(HeterogeneousRuntimeOwnershipError);
    await expect(
      model.assertSessionOwned(
        { provider: 'codex', userId: userA, workspaceId: workspaceB },
        'codex-thread-a',
      ),
    ).rejects.toBeInstanceOf(HeterogeneousRuntimeOwnershipError);
  });

  it('preserves superseded official sessions and resumes only the active topic binding', async () => {
    const scope = { provider: 'codex' as const, userId: userA, workspaceId: workspaceA };
    await model.bindSession({
      ...scope,
      nativeSessionId: 'codex-thread-next',
      nativeThreadId: 'codex-thread-next',
      topicId: 'hetero-topic-a',
    });

    await expect(model.assertSessionOwned(scope, 'codex-thread-a')).resolves.toMatchObject({
      status: 'superseded',
    });
    await expect(model.findActiveTopicSession(scope, 'hetero-topic-a')).resolves.toMatchObject({
      nativeSessionId: 'codex-thread-next',
      status: 'active',
    });
  });
});
