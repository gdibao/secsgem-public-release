// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appSettings } from '../../schemas/commercial';
import type { LobeChatDatabase } from '../../type';
import { EngineeringToolsModel } from '../engineeringTools';

const client = new PGlite();
const db = drizzle({ client, schema: { appSettings } }) as unknown as LobeChatDatabase;
const model = new EngineeringToolsModel(db);

beforeAll(async () => {
  await client.exec(`
    CREATE TABLE app_settings (
      key varchar(128) PRIMARY KEY,
      value jsonb,
      description text,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    );
  `);
});

afterAll(async () => client.close());

describe('EngineeringToolsModel import', () => {
  it('is idempotent and preserves an administrator edit during batch rollback', async () => {
    expect(await model.insertIfMissing('PG001', { importBatchId: 'batch-a', name: 'original' })).toHaveLength(1);
    expect(await model.insertIfMissing('PG001', { importBatchId: 'batch-b', name: 'replacement' })).toHaveLength(0);
    expect((await model.get('PG001'))?.value).toMatchObject({ name: 'original' });

    expect(await model.insertIfMissing('PG002', { importBatchId: 'batch-a', name: 'second' })).toHaveLength(1);
    await model.save('PG001', { name: 'admin edit' });
    expect(await model.removeImported('batch-a')).toHaveLength(1);
    expect((await model.get('PG001'))?.value).toMatchObject({ name: 'admin edit' });
    expect(await model.get('PG002')).toBeUndefined();
  });

  it('keeps a facet batch idempotent and vocabulary owned by the administrator', async () => {
    expect(await model.insertFacetBatchIfMissing('facets-a', { importedAt: 'test' })).toHaveLength(1);
    expect(await model.insertFacetBatchIfMissing('facets-a', { importedAt: 'retry' })).toHaveLength(0);
    expect(await model.insertFacetVocabularyIfMissing({ vendorNames: ['GF'] })).toHaveLength(1);
    await model.saveFacetVocabulary({ vendorNames: ['GF', 'admin-added'] });
    expect(await model.insertFacetVocabularyIfMissing({ vendorNames: ['replacement'] })).toHaveLength(0);
    expect((await model.getFacetVocabulary())?.value).toMatchObject({ vendorNames: ['GF', 'admin-added'] });
  });

  it('locks the actual row before filling missing facets', async () => {
    await model.save('PG003', { id: 'PG003', name: 'admin name' });
    const row = await db.transaction(async (tx) => new EngineeringToolsModel(tx).getForUpdate('PG003'));
    expect(row?.value).toMatchObject({ name: 'admin name' });
  });
});
