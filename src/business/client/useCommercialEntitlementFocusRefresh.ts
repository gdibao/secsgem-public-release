'use client';

import { useEffect, useRef } from 'react';

import { refreshCommercialEntitlementState } from './commercialRefresh';

export const COMMERCIAL_ENTITLEMENT_FOCUS_REFRESH_THROTTLE = 60 * 1000;

export const shouldRefreshCommercialEntitlementOnFocus = ({
  lastRefreshAt,
  now,
  throttle = COMMERCIAL_ENTITLEMENT_FOCUS_REFRESH_THROTTLE,
}: {
  lastRefreshAt: number;
  now: number;
  throttle?: number;
}) => now - lastRefreshAt >= throttle;

export const useCommercialEntitlementFocusRefresh = (isLogin: boolean) => {
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!isLogin || typeof window === 'undefined') return;

    const refresh = () => {
      const now = Date.now();
      if (
        !shouldRefreshCommercialEntitlementOnFocus({
          lastRefreshAt: lastRefreshAtRef.current,
          now,
        })
      )
        return;

      lastRefreshAtRef.current = now;
      void refreshCommercialEntitlementState();
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isLogin]);
};
