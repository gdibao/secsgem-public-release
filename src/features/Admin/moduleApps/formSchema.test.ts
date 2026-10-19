import { describe, expect, it } from 'vitest';

import {
  buildModuleAppPublishWarningCodes,
  buildModuleAppPublishWarnings,
  buildModuleAppUpsertInput,
  createDefaultModuleAppFormValues,
  normalizeModuleAppFormValues,
  parseModuleAppAdminForm,
} from './formSchema';

describe('module app admin form schema', () => {
  it('rejects multipliers outside the shared commerce bounds', () => {
    expect(() =>
      parseModuleAppAdminForm({
        appType: 'ai_app',
        billing: { defaultMultiplier: '101' },
        category: 'AI',
        description: 'AI application',
        displayName: 'AI App',
        slug: 'ai-app',
      }),
    ).toThrow();

    expect(() =>
      parseModuleAppAdminForm({
        actions: [
          {
            id: 'generate',
            moduleMultiplier: '101',
            name: 'Generate',
            runtimeType: 'content_generation',
          },
        ],
        appType: 'ai_app',
        category: 'AI',
        description: 'AI application',
        displayName: 'AI App',
        slug: 'ai-app',
      }),
    ).toThrow();
  });

  it('creates a safe default draft app form', () => {
    expect(createDefaultModuleAppFormValues()).toMatchObject({
      actions: [],
      appType: 'standard_app',
      billing: {
        chargeMode: 'free',
        defaultMultiplier: 1,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 0,
      },
      pages: [{ key: 'overview', routePath: '/', title: 'Overview', type: 'overview' }],
      status: 'draft',
      tags: [],
    });
  });

  it('normalizes form strings, numbers, tags, pages, actions, entitlements, and billing', () => {
    const values = normalizeModuleAppFormValues({
      actions: [
        {
          id: 'Create Record',
          inputSchemaJson: '{ "fields": [] }',
          moduleMultiplier: '2',
          name: 'Create Record',
          outputSchemaJson: '{}',
          runtimeConfigJson: '{ "collectionKey": "records" }',
          runtimeType: 'record_create',
        },
      ],
      appType: 'standard_app',
      category: ' office ',
      description: ' Saved records app ',
      displayName: ' Workbench ',
      entitlements: [
        {
          discountPercent: '5',
          freeQuotaCredits: '100',
          installable: true,
          plan: 'pro',
          runnable: true,
          visible: true,
        },
      ],
      icon: '',
      pages: [
        {
          actionBindingsJson: '[{ "event": "submit", "actionKey": "create_record" }]',
          dataSourceJson: '{ "collectionKey": "records" }',
          key: 'Records',
          layoutSchemaJson: '{}',
          routePath: 'records',
          sortOrder: '3',
          title: ' Records ',
          type: 'list',
        },
      ],
      slug: ' Work Bench ',
      tags: 'office, records, office',
    });

    expect(values).toMatchObject({
      category: 'office',
      displayName: 'Workbench',
      icon: 'Blocks',
      slug: 'work-bench',
      tags: ['office', 'records'],
    });
    expect(values.pages[0]).toMatchObject({
      dataSource: { collectionKey: 'records' },
      key: 'records',
      routePath: '/records',
      sortOrder: 3,
    });
    expect(values.actions[0]).toMatchObject({
      id: 'create_record',
      moduleMultiplier: 2,
      runtimeConfig: { collectionKey: 'records' },
    });
    expect(values.entitlements[0]).toMatchObject({
      discountPercent: 5,
      freeQuotaCredits: 100,
      plan: 'pro',
      runnable: true,
    });
  });

  it('builds a module app upsert payload accepted by the shared type schema', () => {
    const input = buildModuleAppUpsertInput(
      normalizeModuleAppFormValues({
        appType: 'standard_app',
        category: 'office',
        description: 'Simple workbench app.',
        displayName: 'Workbench',
        icon: 'Blocks',
        slug: 'workbench',
      }),
    );

    expect(input).toMatchObject({
      appType: 'standard_app',
      category: 'office',
      displayName: 'Workbench',
      pages: [{ key: 'overview', routePath: '/', title: 'Overview', type: 'overview' }],
      slug: 'workbench',
      status: 'draft',
    });
  });

  it('keeps parseModuleAppAdminForm compatible with existing minimum payloads', () => {
    expect(
      parseModuleAppAdminForm({
        appType: 'standard_app',
        category: 'Productivity',
        description: 'A saved records app',
        displayName: 'Record Desk',
        icon: 'Notebook',
        slug: 'record-desk',
      }),
    ).toMatchObject({
      appType: 'standard_app',
      slug: 'record-desk',
      status: 'draft',
    });
  });

  it('rejects invalid JSON fields before building the upsert payload', () => {
    expect(() =>
      normalizeModuleAppFormValues({
        appType: 'standard_app',
        category: 'office',
        description: 'Simple workbench app.',
        displayName: 'Workbench',
        pages: [
          {
            dataSourceJson: '{',
            key: 'records',
            routePath: '/records',
            title: 'Records',
            type: 'list',
          },
        ],
        slug: 'workbench',
      }),
    ).toThrow('Invalid JSON in pages[0].dataSourceJson');
  });

  it('builds publish warnings for incomplete app manifests', () => {
    expect(buildModuleAppPublishWarningCodes({ actions: [], entitlements: [], pages: [] })).toEqual(
      ['noPages', 'noActions', 'noVisibleEntitlement'],
    );
    expect(buildModuleAppPublishWarnings({ actions: [], entitlements: [], pages: [] })).toEqual([
      'No pages configured',
      'No runnable actions configured',
      'No visible plan entitlement configured',
    ]);
  });

  it('converts an existing app detail into editable form values', () => {
    const values = normalizeModuleAppFormValues({
      actions: [
        {
          id: 'create_record',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Create record',
          outputSchema: {},
          runtimeConfig: { collectionKey: 'records' },
          runtimeType: 'record_create',
        },
      ],
      appType: 'standard_app',
      billing: { chargeMode: 'free', defaultMultiplier: 1 },
      category: 'office',
      description: 'Simple workbench app.',
      displayName: 'Workbench',
      icon: 'Blocks',
      id: '00000000-0000-4000-8000-000000000001',
      pages: [{ key: 'overview', routePath: '/', title: 'Overview', type: 'overview' }],
      slug: 'workbench',
      status: 'draft',
      tags: ['office'],
    });

    expect(values.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(values.actions[0].runtimeConfigJson).toContain('collectionKey');
    expect(values.pages[0].dataSourceJson).toBe('');
  });
});
