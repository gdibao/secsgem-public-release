import { describe, expect, it } from 'vitest';

import { validateModuleAppDataQuery, validateModuleAppDataValues } from './schemaValidator';

const schema = {
  additionalJson: false,
  fields: [
    { key: 'email', required: true, sensitive: false, type: 'string' as const },
    { key: 'score', required: false, sensitive: false, type: 'number' as const },
    { key: 'active', required: false, sensitive: false, type: 'boolean' as const },
  ],
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['score'], unique: false },
  ],
  key: 'candidates',
};

describe('module app data schema validator', () => {
  it('validates required fields, types, and undeclared values', () => {
    expect(validateModuleAppDataValues(schema, { email: 'one@example.com', score: 90 })).toEqual({
      email: 'one@example.com',
      score: 90,
    });
    expect(() => validateModuleAppDataValues(schema, { score: 90 })).toThrow(
      'MODULE_APP_DATA_SCHEMA_INVALID',
    );
    expect(() => validateModuleAppDataValues(schema, { email: 'one@example.com', score: '90' })).toThrow(
      'MODULE_APP_DATA_SCHEMA_INVALID',
    );
    expect(() => validateModuleAppDataValues(schema, { email: 'one@example.com', extra: true })).toThrow(
      'MODULE_APP_DATA_SCHEMA_INVALID',
    );
  });

  it('allows partial updates but still validates supplied fields', () => {
    expect(validateModuleAppDataValues(schema, { score: 95 }, { partial: true })).toEqual({ score: 95 });
    expect(() => validateModuleAppDataValues(schema, { active: 'yes' }, { partial: true })).toThrow(
      'MODULE_APP_DATA_SCHEMA_INVALID',
    );
  });

  it('normalizes dates and rejects oversized rows', () => {
    const datedSchema = {
      ...schema,
      fields: [...schema.fields, { key: 'applied_at', required: false, sensitive: false, type: 'date' as const }],
    };
    expect(
      validateModuleAppDataValues(datedSchema, {
        applied_at: '2026-07-11T08:30:00+08:00',
        email: 'one@example.com',
      }),
    ).toMatchObject({ applied_at: '2026-07-11T00:30:00.000Z' });
    expect(() =>
      validateModuleAppDataValues(
        { ...schema, additionalJson: true },
        { email: 'one@example.com', payload: 'x'.repeat(256 * 1024) },
      ),
    ).toThrow('MODULE_APP_DATA_VALUE_TOO_LARGE');
  });

  it('allows filters on declared fields and sort only on declared index prefixes', () => {
    expect(
      validateModuleAppDataQuery(schema, {
        filters: [{ field: 'active', operator: 'eq', value: true }],
        limit: 20,
        sort: [{ direction: 'desc', field: 'score' }],
        tableKey: 'candidates',
      }),
    ).toMatchObject({ limit: 20 });
    expect(() =>
      validateModuleAppDataQuery(schema, {
        filters: [],
        limit: 20,
        sort: [{ direction: 'asc', field: 'active' }],
        tableKey: 'candidates',
      }),
    ).toThrow('MODULE_APP_DATA_SORT_NOT_INDEXED');
  });
});
