import { Buffer } from 'node:buffer';

import {
  type ModuleAppDataField,
  type ModuleAppDataQuery,
  moduleAppDataQuerySchema,
  type ModuleAppTableSchema,
} from '@lobechat/types';

const invalidSchema = (): never => {
  throw new Error('MODULE_APP_DATA_SCHEMA_INVALID');
};

const MAX_ROW_BYTES = 256 * 1024;

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Object.values(value).every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  return false;
};

const isFieldValue = (field: ModuleAppDataField, value: unknown) => {
  switch (field.type) {
    case 'string':
    case 'reference': {
      return typeof value === 'string';
    }
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value);
    }
    case 'boolean': {
      return typeof value === 'boolean';
    }
    case 'date': {
      return (
        value instanceof Date ||
        (typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)))
      );
    }
    case 'json': {
      return isJsonValue(value);
    }
  }
};

export const validateModuleAppDataValues = (
  schema: ModuleAppTableSchema,
  values: Record<string, unknown>,
  options: { partial?: boolean } = {},
) => {
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const output: Record<string, unknown> = {};

  if (!options.partial) {
    for (const field of schema.fields) {
      if (field.required && values[field.key] === undefined && field.defaultValue === undefined) {
        invalidSchema();
      }
    }
  }

  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) {
      if (!schema.additionalJson || !isJsonValue(value)) invalidSchema();
      output[key] = value;
      continue;
    }
    if (value === undefined || !isFieldValue(field, value)) invalidSchema();
    output[key] = field.type === 'date' ? new Date(value as Date | string).toISOString() : value;
  }

  if (!options.partial) {
    for (const field of schema.fields) {
      if (output[field.key] === undefined && field.defaultValue !== undefined) {
        if (!isFieldValue(field, field.defaultValue)) invalidSchema();
        output[field.key] =
          field.type === 'date'
            ? new Date(field.defaultValue as Date | string).toISOString()
            : field.defaultValue;
      }
    }
  }

  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_ROW_BYTES) {
    throw new Error('MODULE_APP_DATA_VALUE_TOO_LARGE');
  }

  return output;
};

export const validateModuleAppDataQuery = (
  schema: ModuleAppTableSchema,
  input: ModuleAppDataQuery,
) => {
  const query = moduleAppDataQuerySchema.parse(input);
  const fields = new Map(schema.fields.map((field) => [field.key, field]));

  for (const filter of query.filters) {
    const field = fields.get(filter.field);
    if (!field) throw new Error('MODULE_APP_DATA_SCHEMA_INVALID');
    if (!isFieldValue(field, filter.value)) invalidSchema();
    if (filter.operator === 'prefix' && field.type !== 'string') invalidSchema();
    if (field.type === 'json' && filter.operator !== 'eq') invalidSchema();
  }

  if (query.sort.length > 0) {
    const sortFields = query.sort.map((sort) => sort.field);
    const indexed = schema.indexes.some(
      (index) =>
        sortFields.length <= index.fields.length &&
        sortFields.every((field, position) => field === index.fields[position]),
    );
    if (!indexed) throw new Error('MODULE_APP_DATA_SORT_NOT_INDEXED');
  }

  return query;
};
