// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appSettings } from '../../schemas/commercial';
import type { LobeChatDatabase } from '../../type';
import { EngineeringToolsWorkspaceModel } from '../engineeringToolsWorkspace';

const client = new PGlite();
const db = drizzle({ client, schema: { appSettings } }) as unknown as LobeChatDatabase;
const model = new EngineeringToolsWorkspaceModel(db);
const id = '2879619d-dd64-4f9b-a922-94e742f579c9';

beforeAll(async () => {
  await client.exec(`CREATE TABLE app_settings (
    key varchar(128) PRIMARY KEY, value jsonb, description text,
    created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL
  );`);
});
afterAll(async () => client.close());

describe('EngineeringToolsWorkspaceModel', () => {
  it('isolates personal, shared, endpoint and existing catalog prefixes', async () => {
    await db.insert(appSettings).values({ key: 'engineeringTools.item.PG001', value: { name: 'catalog' } });
    expect(await model.create('personal', 'user-a\0workspace-a', id, { version: 1 })).toBe(true);
    expect(await model.create('shared', 'workspace-a', id, { version: 1 })).toBe(true);
    expect(await model.create('endpoint', 'global', id, { version: 1 })).toBe(true);
    expect(await model.list('personal', 'user-b\0workspace-a')).toHaveLength(0);
    expect(await model.list('personal', 'user-a\0workspace-b')).toHaveLength(0);
    expect(await model.list('personal', 'user-a\0workspace-a')).toHaveLength(1);
    expect(await model.list('shared', 'workspace-a')).toHaveLength(1);
    expect(await db.query.appSettings.findFirst()).toBeDefined();
    expect((await db.query.appSettings.findFirst({ where: (table, { eq }) => eq(table.key, 'engineeringTools.item.PG001') }))?.value).toEqual({ name: 'catalog' });
  });

  it('rejects two first writes to the same collection key', async () => {
    const otherId = '0c139538-ee25-4d9d-a36d-99eef55f738b';
    const result = await Promise.all([
      model.create('personal', 'user-a\0workspace-a', otherId, { name: 'first', version: 1 }),
      model.create('personal', 'user-a\0workspace-a', otherId, { name: 'second', version: 1 }),
    ]);
    expect(result.sort()).toEqual([false, true]);
    expect(await model.list('personal', 'user-a\0workspace-a')).toHaveLength(2);
  });

  it('allows the same tool in separate collections without replacing either', async () => {
    const first = '0be6fb91-3772-4a52-af7e-d4419bbec3f3';
    const second = '8fa02189-136c-4f1c-b7ba-526d136e7a86';
    const entry = { toolId: 'PG001', groupId: null, alias: null, defaultEndpointId: null, sortOrder: 0 };
    expect(await model.create('personal', 'user-c\0workspace-a', first, { entries: [entry], version: 1 })).toBe(true);
    expect(await model.create('personal', 'user-c\0workspace-a', second, { entries: [entry], version: 1 })).toBe(true);
    expect(await model.list('personal', 'user-c\0workspace-a')).toHaveLength(2);
  });

  it('uses version CAS so a stale tab cannot overwrite a newer write', async () => {
    expect(await model.replace('personal', 'user-a\0workspace-a', id, 1, { version: 2, name: 'new' })).toBe(true);
    expect(await model.replace('personal', 'user-a\0workspace-a', id, 1, { version: 2, name: 'stale' })).toBe(false);
    expect((await model.get('personal', 'user-a\0workspace-a', id))?.value).toMatchObject({ name: 'new', version: 2 });
    expect(await model.remove('personal', 'user-a\0workspace-a', id, 1)).toBe(false);
    expect(await model.remove('personal', 'user-a\0workspace-a', id, 2)).toBe(true);
  });
});
