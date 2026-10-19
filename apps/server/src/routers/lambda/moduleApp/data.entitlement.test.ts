import { describe, expect, it } from 'vitest';

import { assertDetailEntitlement } from './data';

const detail = {
  id: '10000000-0000-4000-8000-000000000001',
  installed: false,
  planState: { installable: false, runnable: false, visible: true },
  status: 'published',
};

describe('assertDetailEntitlement commerce context', () => {
  it('allows installation when an active purchased license exists outside the plan', async () => {
    await expect(
      assertDetailEntitlement({
        commerceModel: {
          resolveEntitlementContext: async () => ({
            license: {
              endsAt: null,
              id: 'license-1',
              source: 'purchase',
              startsAt: new Date('2026-07-14T00:00:00.000Z'),
              status: 'active',
            },
            productType: 'one_time',
          }),
        } as never,
        db: {} as never,
        detail: detail as never,
        operation: 'install',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ licenseId: 'license-1', source: 'purchase' });
  });

  it('reports purchase required for a paid product without a license', async () => {
    await expect(
      assertDetailEntitlement({
        commerceModel: {
          resolveEntitlementContext: async () => ({ license: null, productType: 'one_time' }),
        } as never,
        db: {} as never,
        detail: detail as never,
        operation: 'install',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ message: 'module_app_purchase_required' });
  });
});
