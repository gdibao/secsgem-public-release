import { DEFAULT_RUNTIME_BRAND } from '@/const/brand';

export const normalizePublicBrandName = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_RUNTIME_BRAND.name;
