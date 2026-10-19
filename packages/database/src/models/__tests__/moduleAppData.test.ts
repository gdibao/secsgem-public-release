// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppDataRows,
  moduleAppDataSchemas,
  moduleAppInstallations,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppDataModel } from '../moduleAppData';

const USER_ID = 'module-app-data-user';
const serverDB: LobeChatDatabase = await getTestDB();

const createInstallation = async () => {
  const [app] = await serverDB
    .insert(moduleApps)
    .values({
      appType: 'standard_app',
      category: 'business',
      description: 'Managed data test.',
      displayName: 'Managed Data',
      icon: 'Database',
      slug: `managed-data-${crypto.randomUUID()}`,
    })
    .returning();
  const [version] = await serverDB
    .insert(moduleAppVersions)
    .values({ appId: app.id, version: '1.0.0' })
    .returning();
  const [installation] = await serverDB
    .insert(moduleAppInstallations)
    .values({ appId: app.id, scopeType: 'personal', userId: USER_ID, versionId: version.id })
    .returning();
  return installation;
};

beforeEach(async () => {
  await serverDB.delete(moduleAppDataRows);
  await serverDB.delete(moduleAppDataSchemas);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
});

describe('ModuleAppDataModel', () => {
  it('isolates schemas and rows by installation', async () => {
    const installationA = await createInstallation();
    const installationB = await createInstallation();
    const model = new ModuleAppDataModel(serverDB);
    const schema = {
      fields: [{ key: 'email', required: true, type: 'string' as const }],
      indexes: [{ fields: ['email'], unique: true }],
      key: 'candidates',
    };

    await model.createSchema({
      installationId: installationA.id,
      schema,
      tableKey: 'candidates',
      version: 1,
    });
    await model.insertRow({
      installationId: installationA.id,
      rowKey: 'candidate-1',
      schemaVersion: 1,
      tableKey: 'candidates',
      values: { email: 'one@example.com' },
    });

    await expect(
      model.getRow({
        installationId: installationB.id,
        rowKey: 'candidate-1',
        tableKey: 'candidates',
      }),
    ).resolves.toBeNull();
    await expect(
      model.getRow({
        installationId: installationA.id,
        rowKey: 'candidate-1',
        tableKey: 'candidates',
      }),
    ).resolves.toMatchObject({ values: { email: 'one@example.com' } });
    await expect(
      serverDB.insert(moduleAppDataRows).values({
        installationId: installationB.id,
        rowKey: 'undeclared-schema',
        schemaVersion: 1,
        tableKey: 'candidates',
        values: {},
      }),
    ).rejects.toThrow();
  });

  it('enforces immutable schema versions and installation-local row keys', async () => {
    const installationA = await createInstallation();
    const installationB = await createInstallation();
    const model = new ModuleAppDataModel(serverDB);
    const schema = {
      fields: [{ key: 'email', type: 'string' as const }],
      indexes: [],
      key: 'candidates',
    };

    await model.createSchema({ installationId: installationA.id, schema, tableKey: 'candidates', version: 1 });
    await model.createSchema({ installationId: installationB.id, schema, tableKey: 'candidates', version: 1 });
    await expect(
      model.createSchema({ installationId: installationA.id, schema, tableKey: 'candidates', version: 1 }),
    ).rejects.toThrow();
    await model.insertRow({
      installationId: installationA.id,
      rowKey: 'same-key',
      schemaVersion: 1,
      tableKey: 'candidates',
      values: {},
    });
    await expect(
      model.insertRow({
        installationId: installationA.id,
        rowKey: 'same-key',
        schemaVersion: 1,
        tableKey: 'candidates',
        values: {},
      }),
    ).rejects.toThrow();
    await expect(
      model.insertRow({
        installationId: installationB.id,
        rowKey: 'same-key',
        schemaVersion: 1,
        tableKey: 'candidates',
        values: {},
      }),
    ).resolves.toMatchObject({ rowKey: 'same-key' });
  });

  it('selects the latest active schema and paginates active rows', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppDataModel(serverDB);
    const schema = {
      fields: [
        { key: 'email', required: true, type: 'string' as const },
        { key: 'score', type: 'number' as const },
      ],
      indexes: [{ fields: ['score'] }],
      key: 'candidates',
    };
    await model.createSchema({ installationId: installation.id, schema, tableKey: 'candidates', version: 1 });
    await model.createSchema({ installationId: installation.id, schema, tableKey: 'candidates', version: 2 });
    await expect(
      model.getActiveSchema({ installationId: installation.id, tableKey: 'candidates' }),
    ).resolves.toMatchObject({ version: 2 });

    for (const [rowKey, score] of [
      ['one', 10],
      ['two', 20],
      ['three', 30],
    ] as const) {
      await model.insertRow({
        installationId: installation.id,
        rowKey,
        schemaVersion: 2,
        schemaSnapshot: schema,
        tableKey: 'candidates',
        values: { email: `${rowKey}@example.com`, score },
      });
    }

    const first = await model.listRows({
      fieldTypes: { score: 'number' },
      installationId: installation.id,
      limit: 2,
      sort: [{ direction: 'asc' as const, field: 'score' }],
      tableKey: 'candidates',
    });
    expect(first.items.map((item) => item.rowKey)).toEqual(['one', 'two']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await model.listRows({
      cursor: first.nextCursor!,
      fieldTypes: { score: 'number' },
      installationId: installation.id,
      limit: 2,
      sort: [{ direction: 'asc' as const, field: 'score' }],
      tableKey: 'candidates',
    });
    expect(second.items.map((item) => item.rowKey)).toEqual(['three']);

    await model.archiveRow({ installationId: installation.id, rowKey: 'two', tableKey: 'candidates' });
    const active = await model.listRows({
      fieldTypes: {},
      installationId: installation.id,
      limit: 10,
      tableKey: 'candidates',
    });
    expect(active.items.map((item) => item.rowKey).sort()).toEqual(['one', 'three']);
  });

  it('enforces logical unique indexes and references inside transactions', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppDataModel(serverDB);
    const candidates = {
      fields: [{ key: 'email', required: true, type: 'string' as const }],
      indexes: [{ fields: ['email'], unique: true }],
      key: 'candidates',
    };
    const applications = {
      fields: [
        {
          key: 'candidate',
          reference: { field: 'id', tableKey: 'candidates' },
          required: true,
          type: 'reference' as const,
        },
      ],
      indexes: [],
      key: 'applications',
    };
    await model.createSchema({ installationId: installation.id, schema: candidates, tableKey: 'candidates', version: 1 });
    await model.createSchema({ installationId: installation.id, schema: applications, tableKey: 'applications', version: 1 });
    await model.insertRow({
      installationId: installation.id,
      rowKey: 'candidate-1',
      schemaSnapshot: candidates,
      schemaVersion: 1,
      tableKey: 'candidates',
      values: { email: 'one@example.com' },
    });
    await expect(
      model.insertRow({
        installationId: installation.id,
        rowKey: 'candidate-duplicate',
        schemaSnapshot: candidates,
        schemaVersion: 1,
        tableKey: 'candidates',
        values: { email: 'one@example.com' },
      }),
    ).rejects.toThrow('MODULE_APP_DATA_UNIQUE_CONSTRAINT');
    await expect(
      model.insertRow({
        installationId: installation.id,
        rowKey: 'application-missing',
        schemaSnapshot: applications,
        schemaVersion: 1,
        tableKey: 'applications',
        values: { candidate: 'missing' },
      }),
    ).rejects.toThrow('MODULE_APP_DATA_REFERENCE_NOT_FOUND');

    await expect(
      model.transaction({
        installationId: installation.id,
        operations: [
          {
            operation: 'insert',
            rowKey: 'candidate-2',
            schemaSnapshot: candidates,
            schemaVersion: 1,
            tableKey: 'candidates',
            values: { email: 'two@example.com' },
          },
          {
            operation: 'insert',
            rowKey: 'application-2',
            schemaSnapshot: applications,
            schemaVersion: 1,
            tableKey: 'applications',
            values: { candidate: 'candidate-2' },
          },
        ],
      }),
    ).resolves.toHaveLength(2);
  });
});
