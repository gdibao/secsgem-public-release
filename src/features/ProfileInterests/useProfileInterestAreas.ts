'use client';

import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { buildProfileInterestAreas } from './interestAreas';

export const PROFILE_INTEREST_AREAS_SWR_KEY = 'profile-interest-areas';

export const useProfileInterestAreas = () => {
  const { data } = useClientDataSWR(PROFILE_INTEREST_AREAS_SWR_KEY, () =>
    adminCommercialService.getPublicProfileOptions(),
  );

  return useMemo(() => buildProfileInterestAreas(data?.interestAreas), [data?.interestAreas]);
};
