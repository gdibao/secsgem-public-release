import { describe, expect, it } from 'vitest';

import type { AdminModuleAppDetail } from '../types';
import { buildIdentityUpsertInput, createDefaultModuleAppIdentity } from './identityForm';

describe('module app identity input', () => {
  it('preserves nested configuration while editing identity fields', () => {
    const current = {
      actions: [
        {
          id: 'archive',
          inputSchema: { fields: [] },
          moduleMultiplier: 1,
          name: 'Archive',
          outputSchema: {},
          runtimeConfig: { functionKey: 'archive_records' },
          runtimeType: 'executable_action',
        },
      ],
      appType: 'standard_app',
      billing: {
        chargeMode: 'fixed',
        defaultMultiplier: 2,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 10,
      },
      category: 'productivity',
      description: 'A configurable workbench.',
      displayName: 'Workbench',
      entitlements: [
        {
          discountPercent: 0,
          freeQuotaCredits: 0,
          installable: true,
          plan: 'pro',
          runnable: true,
          visible: true,
        },
      ],
      icon: 'Blocks',
      id: '00000000-0000-4000-8000-000000000001',
      pages: [
        {
          actionBindings: [],
          dataSource: {},
          key: 'overview',
          layoutSchema: {},
          routePath: '/',
          sortOrder: 0,
          title: 'Overview',
          type: 'overview',
        },
      ],
      slug: 'workbench',
      source: 'admin',
      status: 'draft',
      tags: ['work'],
    } satisfies AdminModuleAppDetail;

    const input = buildIdentityUpsertInput(
      { category: 'office', displayName: 'Office Workbench', status: 'published' },
      current,
    );

    expect(input).toMatchObject({
      actions: current.actions,
      billing: current.billing,
      category: 'office',
      displayName: 'Office Workbench',
      entitlements: current.entitlements,
      pages: current.pages,
      status: 'published',
    });
  });

  it('starts a new application from safe defaults', () => {
    expect(createDefaultModuleAppIdentity()).toMatchObject({
      category: '',
      displayName: '',
      source: 'admin',
      status: 'draft',
    });
  });
});
