'use client';

import { BRANDING_NAME } from '@lobechat/business-const';

import { useBrand } from './BrandProvider';

/**
 * Returns the runtime brand name configured by an admin, falling back to
 * the build-time `BRANDING_NAME` when no runtime override exists.
 *
 * Use this in user-visible chrome (titles, footers, headers, etc.) so that
 * admin-configured branding immediately replaces "LobeHub" without a rebuild.
 */
export const useBrandName = (): string => {
  const brand = useBrand();
  return brand.name && brand.name.trim() ? brand.name : BRANDING_NAME;
};
