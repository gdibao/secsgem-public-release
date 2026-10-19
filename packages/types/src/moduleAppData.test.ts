import { describe, expect, it } from 'vitest';

import {
  moduleAppDataArchiveInputSchema,
  moduleAppDataGetInputSchema,
  moduleAppDataInsertInputSchema,
  moduleAppDataQuerySchema,
  moduleAppDataTransactionSchema,
  moduleAppDataUpdateInputSchema,
  moduleAppTableSchema,
} from './moduleAppData';

const candidatesTable = {
  fields: [
    { key: 'email', required: true, type: 'string' },
    { key: 'score', type: 'number' },
    { key: 'profile', type: 'json' },
  ],
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['score'] },
  ],
  key: 'candidates',
};

describe('module app managed data contracts', () => {
  it('accepts bounded logical tables with declared fields and indexes', () => {
    expect(moduleAppTableSchema.parse(candidatesTable)).toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ key: 'email', required: true })]),
      key: 'candidates',
    });
  });

  it('rejects duplicate fields and indexes over undeclared fields', () => {
    expect(() =>
      moduleAppTableSchema.parse({
        ...candidatesTable,
        fields: [
          { key: 'email', type: 'string' },
          { key: 'email', type: 'string' },
        ],
      }),
    ).toThrow();
    expect(() =>
      moduleAppTableSchema.parse({
        ...candidatesTable,
        indexes: [{ fields: ['missing'] }],
      }),
    ).toThrow();
  });

  it('bounds cursor queries and only accepts declared query operators', () => {
    expect(
      moduleAppDataQuerySchema.parse({
        filters: [{ field: 'score', operator: 'gte', value: 80 }],
        limit: 20,
        sort: [{ direction: 'desc', field: 'score' }],
        tableKey: 'candidates',
      }),
    ).toMatchObject({ limit: 20, tableKey: 'candidates' });
    expect(() => moduleAppDataQuerySchema.parse({ limit: 101, tableKey: 'candidates' })).toThrow();
    expect(() =>
      moduleAppDataQuerySchema.parse({
        filters: [{ field: 'score', operator: 'contains', value: 80 }],
        tableKey: 'candidates',
      }),
    ).toThrow();
  });

  it('limits a managed transaction to one hundred operations', () => {
    const operation = {
      operation: 'insert',
      rowKey: 'candidate-1',
      tableKey: 'candidates',
      values: { email: 'candidate@example.com' },
    };

    expect(moduleAppDataTransactionSchema.parse({ operations: [operation] }).operations).toHaveLength(1);
    expect(() =>
      moduleAppDataTransactionSchema.parse({ operations: Array.from({ length: 101 }, () => operation) }),
    ).toThrow();
  });

  it('defines strict row mutation inputs', () => {
    expect(
      moduleAppDataInsertInputSchema.parse({
        rowKey: 'candidate-1',
        tableKey: 'candidates',
        values: { email: 'candidate@example.com' },
      }),
    ).toMatchObject({ tableKey: 'candidates' });
    expect(
      moduleAppDataUpdateInputSchema.parse({
        rowKey: 'candidate-1',
        tableKey: 'candidates',
        values: { score: 90 },
      }),
    ).toMatchObject({ rowKey: 'candidate-1' });
    expect(moduleAppDataGetInputSchema.parse({ rowKey: 'candidate-1', tableKey: 'candidates' })).toBeDefined();
    expect(moduleAppDataArchiveInputSchema.parse({ rowKey: 'candidate-1', tableKey: 'candidates' })).toBeDefined();
    expect(() =>
      moduleAppDataUpdateInputSchema.parse({ tableKey: 'candidates', values: {} }),
    ).toThrow();
  });
});
