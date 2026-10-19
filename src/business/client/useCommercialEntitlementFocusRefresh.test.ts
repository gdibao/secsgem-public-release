import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_ENTITLEMENT_FOCUS_REFRESH_THROTTLE,
  shouldRefreshCommercialEntitlementOnFocus,
} from './useCommercialEntitlementFocusRefresh';

describe('shouldRefreshCommercialEntitlementOnFocus', () => {
  it('allows the first focus refresh', () => {
    expect(shouldRefreshCommercialEntitlementOnFocus({ lastRefreshAt: 0, now: Date.now() })).toBe(
      true,
    );
  });

  it('throttles repeated focus refreshes', () => {
    expect(
      shouldRefreshCommercialEntitlementOnFocus({
        lastRefreshAt: 10_000,
        now: 10_000 + COMMERCIAL_ENTITLEMENT_FOCUS_REFRESH_THROTTLE - 1,
      }),
    ).toBe(false);
  });

  it('allows refresh after the throttle window', () => {
    expect(
      shouldRefreshCommercialEntitlementOnFocus({
        lastRefreshAt: 10_000,
        now: 10_000 + COMMERCIAL_ENTITLEMENT_FOCUS_REFRESH_THROTTLE,
      }),
    ).toBe(true);
  });
});
