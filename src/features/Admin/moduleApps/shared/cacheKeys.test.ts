import { describe, expect, it } from 'vitest';

import { moduleAppCacheKeys } from './cacheKeys';

describe('moduleAppCacheKeys', () => {
  it('builds every stable cache tuple with an explicit cursor slot', () => {
    expect(moduleAppCacheKeys.apps('status=draft')).toEqual([
      'admin-module-apps',
      'apps',
      'status=draft',
      '',
    ]);
    expect(moduleAppCacheKeys.artifacts('app-1', 'cursor-2')).toEqual([
      'admin-module-apps',
      'artifacts',
      'app-1',
      'cursor-2',
    ]);
    expect(moduleAppCacheKeys.audit('app-1')).toEqual(['admin-module-apps', 'audit', 'app-1', '']);
    expect(moduleAppCacheKeys.detail('app-1')).toEqual(['admin-module-apps', 'detail', 'app-1']);
    expect(moduleAppCacheKeys.installs('app-1')).toEqual([
      'admin-module-apps',
      'installs',
      'app-1',
      '',
    ]);
    expect(moduleAppCacheKeys.packages('review')).toEqual([
      'admin-module-apps',
      'packages',
      'review',
      '',
    ]);
    expect(moduleAppCacheKeys.payments('status=paid')).toEqual([
      'admin-module-apps',
      'payments',
      'status=paid',
      '',
    ]);
    expect(moduleAppCacheKeys.payouts('pending')).toEqual([
      'admin-module-apps',
      'payouts',
      'pending',
      '',
    ]);
    expect(moduleAppCacheKeys.products('app-1')).toEqual([
      'admin-module-apps',
      'products',
      'app-1',
    ]);
    expect(moduleAppCacheKeys.publishers('active')).toEqual([
      'admin-module-apps',
      'publishers',
      'active',
      '',
    ]);
    expect(moduleAppCacheKeys.records('app-1')).toEqual([
      'admin-module-apps',
      'records',
      'app-1',
      '',
    ]);
    expect(moduleAppCacheKeys.revenue('period=month')).toEqual([
      'admin-module-apps',
      'revenue',
      'period=month',
      '',
    ]);
    expect(moduleAppCacheKeys.runs('app-1')).toEqual(['admin-module-apps', 'runs', 'app-1', '']);
    expect(moduleAppCacheKeys.runtime('runs', 'app-1', 10)).toEqual([
      'admin-module-apps',
      'runtime',
      'runs',
      'app-1',
      10,
    ]);
    expect(moduleAppCacheKeys.runtime('runs', 'app-1', 10)).not.toEqual(
      moduleAppCacheKeys.runs('app-1'),
    );
  });
});
