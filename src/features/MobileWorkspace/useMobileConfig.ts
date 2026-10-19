'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { DEFAULT_MOBILE_CONFIG, normalizeMobileConfig } from '@/const/mobileConfig';
import {
  type MobileConfigRevisionSnapshot,
  normalizeMobileConfigRevisionSnapshot,
} from '@/const/mobileConfigPublication';
import { mutate as globalMutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

export const MOBILE_CONFIG_SWR_KEY = 'public-mobile-config';
const MOBILE_CONFIG_CACHE_KEY = 'comhub.mobile-config.last-known-good';

export const refreshMobileConfig = () => globalMutate(MOBILE_CONFIG_SWR_KEY);

const fallbackSnapshot: MobileConfigRevisionSnapshot = {
  config: normalizeMobileConfig(DEFAULT_MOBILE_CONFIG),
  revision: 0,
  updatedAt: new Date(0).toISOString(),
};

const readCachedSnapshot = () => {
  if (typeof window === 'undefined') return fallbackSnapshot;

  try {
    const value = window.localStorage.getItem(MOBILE_CONFIG_CACHE_KEY);
    if (!value) return fallbackSnapshot;

    return normalizeMobileConfigRevisionSnapshot(JSON.parse(value), fallbackSnapshot);
  } catch {
    return fallbackSnapshot;
  }
};

const cacheSnapshot = (snapshot: MobileConfigRevisionSnapshot) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(MOBILE_CONFIG_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const fetchMobileConfig = async (): Promise<MobileConfigRevisionSnapshot> => {
  const snapshot = await lambdaClient.admin.settings.getPublicMobileConfigSnapshot.query();
  const normalized = normalizeMobileConfigRevisionSnapshot(snapshot, fallbackSnapshot);
  cacheSnapshot(normalized);
  return normalized;
};

export const useMobileConfig = () => {
  const cachedSnapshot = useMemo(readCachedSnapshot, []);
  const { data, error, isLoading, isValidating, mutate } = useSWR<MobileConfigRevisionSnapshot>(
    MOBILE_CONFIG_SWR_KEY,
    fetchMobileConfig,
    {
      dedupingInterval: 60_000,
      fallbackData: cachedSnapshot,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    },
  );

  return {
    config: normalizeMobileConfig(data?.config),
    error,
    isLoading,
    isUsingCachedConfig: Boolean(error && (data?.revision ?? 0) > 0),
    isValidating,
    mutate,
    revision: data?.revision ?? 0,
    updatedAt: data?.updatedAt ?? fallbackSnapshot.updatedAt,
  };
};
