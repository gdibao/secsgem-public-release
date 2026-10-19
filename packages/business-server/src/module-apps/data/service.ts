import {
  type ModuleAppCapabilityClaims,
  moduleAppDataArchiveInputSchema,
  type ModuleAppDataFieldType,
  type ModuleAppDataFilter,
  moduleAppDataGetInputSchema,
  moduleAppDataInsertInputSchema,
  type ModuleAppDataQuery,
  moduleAppDataQuerySchema,
  type ModuleAppDataSort,
  type ModuleAppDataTransactionOperation,
  moduleAppDataTransactionSchema,
  moduleAppDataUpdateInputSchema,
  type ModuleAppTableSchema,
} from '@lobechat/types';

import { validateModuleAppDataQuery, validateModuleAppDataValues } from './schemaValidator';

const MAX_RESPONSE_BYTES = 1024 * 1024;

type ActiveSchema = { schemaSnapshot: ModuleAppTableSchema; version: number };

type RepositoryOperation = ModuleAppDataTransactionOperation & {
  rowKey: string;
  schemaSnapshot: ModuleAppTableSchema;
  schemaVersion: number;
};

export interface ModuleAppDataRepository {
  archiveRow: (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    tableKey: string;
  }) => Promise<unknown>;
  getActiveSchema: (input: { installationId: string; tableKey: string }) => Promise<ActiveSchema | null | undefined>;
  getRow: (input: { installationId: string; rowKey: string; tableKey: string }) => Promise<unknown>;
  insertRow: (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    schemaVersion: number;
    tableKey: string;
    values: Record<string, unknown>;
  }) => Promise<unknown>;
  listRows: (input: {
    cursor?: string;
    fieldTypes: Record<string, ModuleAppDataFieldType>;
    filters?: ModuleAppDataFilter[];
    installationId: string;
    limit: number;
    sort?: ModuleAppDataSort[];
    tableKey: string;
  }) => Promise<{ items: unknown[]; nextCursor: null | string }>;
  transaction: (input: {
    actorUserId?: string;
    installationId: string;
    operations: RepositoryOperation[];
  }) => Promise<unknown[]>;
  updateRow: (input: {
    actorUserId?: string;
    installationId: string;
    rowKey: string;
    schemaSnapshot: ModuleAppTableSchema;
    schemaVersion: number;
    tableKey: string;
    values: Record<string, unknown>;
  }) => Promise<unknown>;
}

const assertPermission = (capability: ModuleAppCapabilityClaims, permission: string) => {
  if (!capability.permissions.includes(permission)) {
    throw new Error('MODULE_APP_CAPABILITY_DENIED');
  }
};

const assertBoundedResponse = <T>(value: T): T => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('MODULE_APP_DATA_RESPONSE_TOO_LARGE');
  }
  return value;
};

const parseInput = <T>(schema: { parse: (input: unknown) => T }, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch {
    throw new Error('MODULE_APP_DATA_INPUT_INVALID');
  }
};

export class ModuleAppDataService {
  private readonly randomId: () => string;
  private readonly repository: ModuleAppDataRepository;

  constructor(options: { randomId?: () => string; repository: ModuleAppDataRepository }) {
    this.repository = options.repository;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  private getSchema = async (installationId: string, tableKey: string) => {
    const schema = await this.repository.getActiveSchema({ installationId, tableKey });
    if (!schema) throw new Error('MODULE_APP_DATA_SCHEMA_NOT_FOUND');
    return schema;
  };

  archive = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.write');
    const input = parseInput(moduleAppDataArchiveInputSchema, params.input);
    return assertBoundedResponse(
      await this.repository.archiveRow({
        actorUserId: params.capability.userId,
        installationId: params.capability.installationId,
        ...input,
      }),
    );
  };

  get = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.read');
    const input = parseInput(moduleAppDataGetInputSchema, params.input);
    return assertBoundedResponse(
      await this.repository.getRow({ installationId: params.capability.installationId, ...input }),
    );
  };

  insert = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.write');
    const input = parseInput(moduleAppDataInsertInputSchema, params.input);
    const schema = await this.getSchema(params.capability.installationId, input.tableKey);
    const values = validateModuleAppDataValues(schema.schemaSnapshot, input.values);
    return assertBoundedResponse(
      await this.repository.insertRow({
        actorUserId: params.capability.userId,
        installationId: params.capability.installationId,
        rowKey: input.rowKey ?? this.randomId(),
        schemaVersion: schema.version,
        tableKey: input.tableKey,
        values,
      }),
    );
  };

  list = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.read');
    const parsed = parseInput(moduleAppDataQuerySchema, params.input) as ModuleAppDataQuery;
    const schema = await this.getSchema(params.capability.installationId, parsed.tableKey);
    const query = validateModuleAppDataQuery(schema.schemaSnapshot, parsed);
    return assertBoundedResponse(
      await this.repository.listRows({
        ...query,
        fieldTypes: Object.fromEntries(
          schema.schemaSnapshot.fields.map((field) => [field.key, field.type]),
        ),
        installationId: params.capability.installationId,
      }),
    );
  };

  transaction = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.write');
    const input = parseInput(moduleAppDataTransactionSchema, params.input);
    const schemas = new Map<string, ActiveSchema>();
    const operations = [];

    for (const operation of input.operations) {
      let schema = schemas.get(operation.tableKey);
      if (!schema) {
        schema = await this.getSchema(params.capability.installationId, operation.tableKey);
        schemas.set(operation.tableKey, schema);
      }
      operations.push({
        ...operation,
        ...(operation.operation === 'archive'
          ? {}
          : {
              values: validateModuleAppDataValues(schema.schemaSnapshot, operation.values, {
                partial: operation.operation === 'update',
              }),
            }),
        rowKey: operation.rowKey ?? this.randomId(),
        schemaSnapshot: schema.schemaSnapshot,
        schemaVersion: schema.version,
      });
    }

    return assertBoundedResponse(
      await this.repository.transaction({
        actorUserId: params.capability.userId,
        installationId: params.capability.installationId,
        operations,
      }),
    );
  };

  update = async (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'data.write');
    const input = parseInput(moduleAppDataUpdateInputSchema, params.input);
    const schema = await this.getSchema(params.capability.installationId, input.tableKey);
    const values = validateModuleAppDataValues(schema.schemaSnapshot, input.values, { partial: true });
    return assertBoundedResponse(
      await this.repository.updateRow({
        actorUserId: params.capability.userId,
        installationId: params.capability.installationId,
        schemaSnapshot: schema.schemaSnapshot,
        schemaVersion: schema.version,
        ...input,
        values,
      }),
    );
  };
}
