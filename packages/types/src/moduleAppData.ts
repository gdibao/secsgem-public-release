import { z } from 'zod';

const moduleAppDataKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const moduleAppDataFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'json',
  'reference',
]);
export type ModuleAppDataFieldType = z.infer<typeof moduleAppDataFieldTypeSchema>;

export const moduleAppDataFieldSchema = z
  .object({
    defaultValue: z.unknown().optional(),
    key: moduleAppDataKeySchema,
    reference: z
      .object({
        field: moduleAppDataKeySchema.default('id'),
        tableKey: moduleAppDataKeySchema,
      })
      .strict()
      .optional(),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    type: moduleAppDataFieldTypeSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === 'reference' && !field.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_data_reference_required',
        path: ['reference'],
      });
    }
    if (field.type !== 'reference' && field.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_data_reference_unexpected',
        path: ['reference'],
      });
    }
  });
export type ModuleAppDataField = z.infer<typeof moduleAppDataFieldSchema>;

export const moduleAppDataIndexSchema = z
  .object({
    fields: z.array(moduleAppDataKeySchema).min(1).max(4),
    unique: z.boolean().default(false),
  })
  .strict()
  .superRefine((index, ctx) => {
    if (new Set(index.fields).size !== index.fields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_data_index_duplicate_field',
      });
    }
  });
export type ModuleAppDataIndex = z.infer<typeof moduleAppDataIndexSchema>;

export const moduleAppTableSchema = z
  .object({
    additionalJson: z.boolean().default(false),
    fields: z.array(moduleAppDataFieldSchema).min(1).max(100),
    indexes: z.array(moduleAppDataIndexSchema).max(20).default([]),
    key: moduleAppDataKeySchema,
  })
  .strict()
  .superRefine((table, ctx) => {
    const fieldKeys = new Set<string>();
    table.fields.forEach((field, index) => {
      if (fieldKeys.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_data_field_duplicate',
          path: ['fields', index, 'key'],
        });
      }
      fieldKeys.add(field.key);
    });

    const indexKeys = new Set<string>();
    table.indexes.forEach((index, indexPosition) => {
      for (const field of index.fields) {
        if (!fieldKeys.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'module_app_data_index_field_missing',
            path: ['indexes', indexPosition, 'fields'],
          });
        }
      }
      const indexKey = index.fields.join(':');
      if (indexKeys.has(indexKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'module_app_data_index_duplicate',
          path: ['indexes', indexPosition],
        });
      }
      indexKeys.add(indexKey);
    });
  });
export type ModuleAppTableSchema = z.infer<typeof moduleAppTableSchema>;
export type ModuleAppTableInput = z.input<typeof moduleAppTableSchema>;

export const moduleAppDataFilterOperatorSchema = z.enum(['eq', 'gt', 'gte', 'lt', 'lte', 'prefix']);

export const moduleAppDataFilterSchema = z
  .object({
    field: moduleAppDataKeySchema,
    operator: moduleAppDataFilterOperatorSchema,
    value: z.unknown(),
  })
  .strict()
  .superRefine((filter, ctx) => {
    if (filter.operator === 'prefix' && typeof filter.value !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_data_prefix_invalid' });
    }
  });
export type ModuleAppDataFilter = z.infer<typeof moduleAppDataFilterSchema>;

export const moduleAppDataSortSchema = z
  .object({
    direction: z.enum(['asc', 'desc']).default('asc'),
    field: moduleAppDataKeySchema,
  })
  .strict();
export type ModuleAppDataSort = z.infer<typeof moduleAppDataSortSchema>;

export const moduleAppDataQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    filters: z.array(moduleAppDataFilterSchema).max(20).default([]),
    limit: z.number().int().min(1).max(100).default(50),
    sort: z.array(moduleAppDataSortSchema).max(5).default([]),
    tableKey: moduleAppDataKeySchema,
  })
  .strict();
export type ModuleAppDataQuery = z.infer<typeof moduleAppDataQuerySchema>;
export type ModuleAppDataQueryInput = z.input<typeof moduleAppDataQuerySchema>;

const moduleAppDataValuesSchema = z.record(z.string(), z.unknown());
const moduleAppDataRowIdentitySchema = z
  .object({
    rowKey: z.string().min(1).max(160),
    tableKey: moduleAppDataKeySchema,
  })
  .strict();

export const moduleAppDataGetInputSchema = moduleAppDataRowIdentitySchema;
export type ModuleAppDataGetInput = z.infer<typeof moduleAppDataGetInputSchema>;

export const moduleAppDataArchiveInputSchema = moduleAppDataRowIdentitySchema;
export type ModuleAppDataArchiveInput = z.infer<typeof moduleAppDataArchiveInputSchema>;

export const moduleAppDataInsertInputSchema = z
  .object({
    rowKey: z.string().min(1).max(160).optional(),
    tableKey: moduleAppDataKeySchema,
    values: moduleAppDataValuesSchema,
  })
  .strict();
export type ModuleAppDataInsertInput = z.infer<typeof moduleAppDataInsertInputSchema>;

export const moduleAppDataUpdateInputSchema = z
  .object({
    rowKey: z.string().min(1).max(160),
    tableKey: moduleAppDataKeySchema,
    values: moduleAppDataValuesSchema,
  })
  .strict()
  .refine((input) => Object.keys(input.values).length > 0, {
    message: 'module_app_data_update_values_required',
    path: ['values'],
  });
export type ModuleAppDataUpdateInput = z.infer<typeof moduleAppDataUpdateInputSchema>;

const moduleAppDataInsertOperationSchema = z
  .object({
    operation: z.literal('insert'),
    rowKey: z.string().min(1).max(160).optional(),
    tableKey: moduleAppDataKeySchema,
    values: moduleAppDataValuesSchema,
  })
  .strict();

const moduleAppDataUpdateOperationSchema = z
  .object({
    operation: z.literal('update'),
    rowKey: z.string().min(1).max(160),
    tableKey: moduleAppDataKeySchema,
    values: moduleAppDataValuesSchema,
  })
  .strict();

const moduleAppDataArchiveOperationSchema = z
  .object({
    operation: z.literal('archive'),
    rowKey: z.string().min(1).max(160),
    tableKey: moduleAppDataKeySchema,
  })
  .strict();

export const moduleAppDataTransactionOperationSchema = z.discriminatedUnion('operation', [
  moduleAppDataInsertOperationSchema,
  moduleAppDataUpdateOperationSchema,
  moduleAppDataArchiveOperationSchema,
]);
export type ModuleAppDataTransactionOperation = z.infer<
  typeof moduleAppDataTransactionOperationSchema
>;

export const moduleAppDataTransactionSchema = z
  .object({
    operations: z.array(moduleAppDataTransactionOperationSchema).min(1).max(100),
  })
  .strict();
export type ModuleAppDataTransaction = z.infer<typeof moduleAppDataTransactionSchema>;

export const moduleAppDataRowSchema = z
  .object({
    createdAt: z.coerce.date(),
    installationId: z.string().uuid(),
    rowKey: z.string().min(1).max(160),
    status: z.enum(['active', 'archived']),
    tableKey: moduleAppDataKeySchema,
    updatedAt: z.coerce.date(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ModuleAppDataRow = z.infer<typeof moduleAppDataRowSchema>;
