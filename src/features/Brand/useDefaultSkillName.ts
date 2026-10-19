'use client';

import { useBrand } from './BrandProvider';

export const useDefaultSkillName = (): string => {
  const brand = useBrand();
  return brand.defaultSkillName && brand.defaultSkillName.trim()
    ? brand.defaultSkillName
    : brand.name;
};
