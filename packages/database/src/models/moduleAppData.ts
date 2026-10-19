import { Buffer } from 'node:buffer';

import {
  type ModuleAppDataFieldType,
  type ModuleAppDataFilter,
  type ModuleAppDataSort,
  type ModuleAppTableInput,
  type ModuleAppTableSchema,
  moduleAppTableSchema,
} from '@lobechat/types';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

import { moduleAppDataRows, moduleAppDataSchemas } from '../schemas';
import type { LobeChatDatabase } from '../type';

type DataOperation = {
  operation: 'archive' | 'insert' | 'update';
  rowKey: string;
  schemaSnapshot?: ModuleAppTableInput;
  schemaVersion: number;
  tableKey: string;
  values?: Record<string, unknown>;
};

type TransactionDatabase = Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0];

const encodeCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');

const decodeCursor = (cursor?: string) => {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    if (!Number.isInteger(value.offset) || Number(value.offset) < 0 || Number(value.offset) > 1_000_000) {
      throw new Error('invalid module app data cursor offset');
    }
    return Number(value.offset);
  } catch {
    throw new Error('MODULE_APP_DATA_CURSOR_INVALID');
  }
};

const fieldExpression = (field: string, type?: ModuleAppDataFieldType) => {
  const textValue = sql`${moduleAppDataRows.values} ->> ${field}`;
  if (type === 'number') return sql`(${textValue})::numeric`;
  if (type === 'boolean') return sql`(${textValue})::boolean`;
  if (type === 'json') return sql`${moduleAppDataRows.values} -> ${field}`;
  return textValue;
};

const filterExpression = (
  filter: ModuleAppDataFilter,
  fieldTypes: Record<string, ModuleAppDataFieldType>,
) => {
  const expression = fieldExpression(filter.field, fieldTypes[filter.field]);
  if (fieldTypes[filter.field] === 'json') {
    return sql`${expression} = ${JSON.stringify(filter.value)}::jsonb`;
  }
  switch (filter.operator) {
    case 'eq': {
      return sql`${expression} = ${filter.value}`;
    }
    case 'gt': {
      return sql`${expression} > ${filter.value}`;
    }
    case 'gte': {
      return sql`${expression} >= ${filter.value}`;
    }
    case 'lt': {
      return sql`${expression} < ${filter.value}`;
    }
    case 'lte': {
      return sql`${expression} <= ${filter.value}`;
    }
    case 'prefix': {
      return sql`${expression} LIKE ${`${String(filter.value)}%`}`;
    }
  }
};

export class ModuleAppDataModel {
  constructor(private readonly db: LobeChatDatabase) {}

  createSchema = async (input: {
    createdBy?: string;
    installationId: string;
    schema: ModuleAppTableInput;
    tableKey: string;
    version: number;
  }) => {
    const schema = moduleAppTableSchema.parse(input.schema);
    if (schema.key !== input.tableKey) throw new Error('MODULE_APP_DATA_SCHEMA_KEY_MISMATCH');

    const [created] = await this.db
      .insert(moduleAppDataSchemas)
      .values({
        createdBy: input.createdBy,
        installationId: input.installationId,
        schemaSnapshot: schema,
        tableKey: input.tableKey,
        version: input.version,
      })
      .returning();
    if (!created) throw new Error('MODULE_APP_DATA_SCHEMA_CREATE_FAILED');
    return created;
  };

  getActiveSchema = (input: { installationId: string; tableKey: string }) =>
    this.db.query.moduleAppDataSchemas.findFirst({
      orderBy: [desc(moduleAppDataSchemas.version)],
      where: and(
        eq(moduleAppDataSchemas.installationId, input.installationId),
        eq(moduleAppDataSchemas.tableKey, input.tableKey),
        eq(moduleAppDataSchemas.status, 'active'),
      ),
    });

  getSchema = (input: { installationId: string; tableKey: string; version: number }) =>
    this.db.query.moduleAppDataSchemas.findFirst({
      where: and(
        eq(moduleAppDataSchemas.installationId, input.installationId),
        eq(moduleAppDataSchemas.tableKey, input.tableKey),
        eq(moduleAppDataSchemas.version, input.version),
      ),
    });

  private getLockedSchema = async (
    tx: TransactionDatabase,
    input: { installationId: string; tableKey: string; version: number },
  ) => {
    const [schema] = await tx
      .select()
      .from(moduleAppDataSchemas)
      .where(
        and(
          eq(moduleAppDataSchemas.installationId, input.installationId),
          eq(moduleAppDataSchemas.tableKey, input.tableKey),
          eq(moduleAppDataSchemas.version, input.version),
          eq(moduleAppDataSchemas.status, 'active'),
        ),
      )
      .for('update');
    if (!schema) throw new Error('MODULE_APP_DATA_SCHEMA_NOT_FOUND');
    return schema;
  };

  private assertConstraints = async (
    tx: TransactionDatabase,
    input: {
      excludeRowKey?: string;
      installationId: string;
      schema: ModuleAppTableSchema;
      tableKey: string;
      values: Record<string, unknown>;
    },
  ) => {
    for (const index of input.schema.indexes.filter((item) => item.unique)) {
      const indexedValues = Object.fromEntries(
        index.fields.map((field) => [field, input.values[field]]),
      );
      if (Object.values(indexedValues).includes(undefined)) continue;
      const duplicate = await tx.query.moduleAppDataRows.findFirst({
        columns: { id: true },
        where: and(
          eq(moduleAppDataRows.installationId, input.installationId),
          eq(moduleAppDataRows.tableKey, input.tableKey),
          eq(moduleAppDataRows.status, 'active'),
          sql`${moduleAppDataRows.values} @> ${JSON.stringify(indexedValues)}::jsonb`,
          input.excludeRowKey ? ne(moduleAppDataRows.rowKey, input.excludeRowKey) : undefined,
        ),
      });
      if (duplicate) throw new Error('MODULE_APP_DATA_UNIQUE_CONSTRAINT');
    }

    for (const field of input.schema.fields.filter((item) => item.type === 'reference')) {
      const referenceValue = input.values[field.key];
      if (referenceValue === undefined || !field.reference) continue;
      const target = await tx.query.moduleAppDataRows.findFirst({
        columns: { id: true },
        where: and(
          eq(moduleAppDataRows.installationId, input.installationId),
          eq(moduleAppDataRows.tableKey, field.reference.tableKey),
          eq(moduleAppDataRows.status, 'active'),
          field.reference.field === 'id'
            ? eq(moduleAppDataRows.rowKey, String(referenceValue))
            : sql`${moduleAppDataRows.values} ->> ${field.reference.field} = ${String(referenceValue)}`,
        ),
      });
      if (!target) throw new Error('MODULE_APP_DATA_REFERENCE_NOT_FOUND');
    }
  };

  private insertRowInTransaction = async (
    tx: TransactionDatabase,
    input: {
      actorUserId?: string;
      installationId: string;
      rowKey: string;
      schemaVersion: number;
      tableKey: string;
      values: Record<string, unknown>;
    },
  ) => {
    const schema = await this.getLockedSchema(tx, {
      installationId: input.installationId,
      tableKey: input.tableKey,
      version: input.schemaVersion,
    });
    await this.assertConstraints(tx, {
      installationId: input.installationId,
      schema: schema.schemaSnapshot,
      tableKey: input.tableKey,
      values: input.values,
    });
    const [created] = await tx
      .insert(moduleAppDataRows)
      .values({
        createdBy: input.actorUserId,
        installationId: input.installationId,
        rowKey: input.rowKey,
        schemaVersion: input.schemaVersion,
        tableKey: input.tableKey,
        updatedBy: input.actorUserId,
        values: input.values,
      })
      .returning();
    if (!created) throw new Error('MODULE_APP_DATA_ROW_CREATE_FAILED');
    return created;
  };

  insertRow = async (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    schemaSnapshot?: ModuleAppTableInput;
    schemaVersion: number;
    tableKey: string;
    values: Record<string, unknown>;
  }) => this.db.transaction((tx) => this.insertRowInTransaction(tx, input));

  getRow = async (input: { installationId: string; rowKey: string; tableKey: string }) => {
    const row = await this.db.query.moduleAppDataRows.findFirst({
      where: and(
        eq(moduleAppDataRows.installationId, input.installationId),
        eq(moduleAppDataRows.tableKey, input.tableKey),
        eq(moduleAppDataRows.rowKey, input.rowKey),
        eq(moduleAppDataRows.status, 'active'),
      ),
    });
    return row ?? null;
  };

  listRows = async (input: {
    cursor?: string;
    fieldTypes: Record<string, ModuleAppDataFieldType>;
    filters?: ModuleAppDataFilter[];
    installationId: string;
    limit: number;
    sort?: ModuleAppDataSort[];
    tableKey: string;
  }) => {
    const offset = decodeCursor(input.cursor);
    const filters = (input.filters ?? []).map((filter) =>
      filterExpression(filter, input.fieldTypes),
    );
    const orderBy = (input.sort ?? []).map((sort) => {
      const expression = fieldExpression(sort.field, input.fieldTypes[sort.field]);
      return sort.direction === 'desc' ? desc(expression) : asc(expression);
    });
    orderBy.push(asc(moduleAppDataRows.rowKey));
    const rows = await this.db
      .select()
      .from(moduleAppDataRows)
      .where(
        and(
          eq(moduleAppDataRows.installationId, input.installationId),
          eq(moduleAppDataRows.tableKey, input.tableKey),
          eq(moduleAppDataRows.status, 'active'),
          ...filters,
        ),
      )
      .orderBy(...orderBy)
      .limit(input.limit + 1)
      .offset(offset);
    const hasMore = rows.length > input.limit;
    return {
      items: hasMore ? rows.slice(0, input.limit) : rows,
      nextCursor: hasMore ? encodeCursor(offset + input.limit) : null,
    };
  };

  private updateRowInTransaction = async (
    tx: TransactionDatabase,
    input: {
      actorUserId?: string;
      installationId: string;
      rowKey: string;
      schemaVersion: number;
      tableKey: string;
      values: Record<string, unknown>;
    },
  ) => {
    const schema = await this.getLockedSchema(tx, {
      installationId: input.installationId,
      tableKey: input.tableKey,
      version: input.schemaVersion,
    });
    const existing = await tx.query.moduleAppDataRows.findFirst({
      where: and(
        eq(moduleAppDataRows.installationId, input.installationId),
        eq(moduleAppDataRows.tableKey, input.tableKey),
        eq(moduleAppDataRows.rowKey, input.rowKey),
        eq(moduleAppDataRows.status, 'active'),
      ),
    });
    if (!existing) throw new Error('MODULE_APP_DATA_ROW_NOT_FOUND');
    const values = { ...existing.values, ...input.values };
    await this.assertConstraints(tx, {
      excludeRowKey: input.rowKey,
      installationId: input.installationId,
      schema: schema.schemaSnapshot,
      tableKey: input.tableKey,
      values,
    });
    const [updated] = await tx
      .update(moduleAppDataRows)
      .set({
        schemaVersion: input.schemaVersion,
        updatedAt: new Date(),
        updatedBy: input.actorUserId,
        values,
      })
      .where(eq(moduleAppDataRows.id, existing.id))
      .returning();
    if (!updated) throw new Error('MODULE_APP_DATA_ROW_UPDATE_FAILED');
    return updated;
  };

  updateRow = async (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    schemaSnapshot?: ModuleAppTableInput;
    schemaVersion: number;
    tableKey: string;
    values: Record<string, unknown>;
  }) => this.db.transaction((tx) => this.updateRowInTransaction(tx, input));

  private archiveRowInTransaction = async (
    tx: TransactionDatabase,
    input: { actorUserId?: string; installationId: string; rowKey: string; tableKey: string },
  ) => {
    const [updated] = await tx
      .update(moduleAppDataRows)
      .set({ status: 'archived', updatedAt: new Date(), updatedBy: input.actorUserId })
      .where(
        and(
          eq(moduleAppDataRows.installationId, input.installationId),
          eq(moduleAppDataRows.tableKey, input.tableKey),
          eq(moduleAppDataRows.rowKey, input.rowKey),
          eq(moduleAppDataRows.status, 'active'),
        ),
      )
      .returning();
    if (!updated) throw new Error('MODULE_APP_DATA_ROW_NOT_FOUND');
    return updated;
  };

  archiveRow = async (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    tableKey: string;
  }) => this.db.transaction((tx) => this.archiveRowInTransaction(tx, input));

  transaction = async (input: {
    actorUserId?: string;
    installationId: string;
    operations: DataOperation[];
  }) =>
    this.db.transaction(async (tx) => {
      const results = [];
      for (const operation of input.operations) {
        if (operation.operation === 'archive') {
          results.push(
            await this.archiveRowInTransaction(tx, {
              actorUserId: input.actorUserId,
              installationId: input.installationId,
              rowKey: operation.rowKey,
              tableKey: operation.tableKey,
            }),
          );
        } else if (operation.operation === 'insert') {
          results.push(
            await this.insertRowInTransaction(tx, {
              actorUserId: input.actorUserId,
              installationId: input.installationId,
              rowKey: operation.rowKey,
              schemaVersion: operation.schemaVersion,
              tableKey: operation.tableKey,
              values: operation.values ?? {},
            }),
          );
        } else {
          results.push(
            await this.updateRowInTransaction(tx, {
              actorUserId: input.actorUserId,
              installationId: input.installationId,
              rowKey: operation.rowKey,
              schemaVersion: operation.schemaVersion,
              tableKey: operation.tableKey,
              values: operation.values ?? {},
            }),
          );
        }
      }
      return results;
    });
}
