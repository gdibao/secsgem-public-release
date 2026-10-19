'use client';

import { type Key } from 'swr';

import { mutate } from '@/libs/swr';
import { getAiInfraStoreState } from '@/store/aiInfra/store';
import { getUserStoreState } from '@/store/user';

export const COMMERCIAL_ENTITLEMENT_SWR_KEYS: Key[] = [
  ['business-commercial-overview'],
  ['business-plan-catalog'],
  ['business-subscription-change-request'],
  ['business-subscription-change-history'],
  ['business-credit-ledger'],
  ['business-topup-orders'],
  ['commercial.listBillingOrders'],
  ['commercial.listCreditPackages'],
];

const warnRefreshFailure = (reason: unknown) => {
  console.warn('Failed to refresh commercial entitlement state:', reason);
};

export const refreshCommercialEntitlementState = async (extraKeys: Key[] = []) => {
  const refreshTasks = [...COMMERCIAL_ENTITLEMENT_SWR_KEYS, ...extraKeys].map((key) => mutate(key));

  refreshTasks.push(getUserStoreState().refreshUserState());
  refreshTasks.push(getAiInfraStoreState().refreshAiProviderRuntimeState());

  const results = await Promise.allSettled(refreshTasks);

  for (const result of results) {
    if (result.status === 'rejected') warnRefreshFailure(result.reason);
  }
};
