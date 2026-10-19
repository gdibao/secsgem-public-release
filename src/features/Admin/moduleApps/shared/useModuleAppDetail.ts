'use client';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import type { AdminModuleAppDetail } from '../types';
import { moduleAppCacheKeys } from './cacheKeys';

export const useModuleAppDetail = (appId?: null | string) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<AdminModuleAppDetail>(
    appId ? moduleAppCacheKeys.detail(appId) : null,
    () => adminCommercialService.moduleApps.get({ appId: appId! }) as Promise<AdminModuleAppDetail>,
  );

  return { app: data, error, isLoading, refresh: mutate };
};
