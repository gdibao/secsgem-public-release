import { BriefcaseIcon, type LucideIcon } from 'lucide-react';

import { INTEREST_AREAS, type InterestAreaKey } from '@/features/Onboarding/config';

export type ConfiguredInterestArea = {
  key: string;
  label: string;
};

export type BuiltinProfileInterestArea = {
  custom?: false;
  icon: LucideIcon;
  key: InterestAreaKey;
};

export type CustomProfileInterestArea = ConfiguredInterestArea & {
  custom: true;
  icon: LucideIcon;
};

export type ProfileInterestArea = BuiltinProfileInterestArea | CustomProfileInterestArea;

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const normalizeConfiguredInterestAreas = (value: unknown): ConfiguredInterestArea[] => {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: ConfiguredInterestArea[] = [];

  for (const item of items) {
    const label =
      typeof item === 'string'
        ? normalizeText(item)
        : item && typeof item === 'object'
          ? normalizeText((item as Record<string, unknown>).label)
          : '';
    const key =
      item && typeof item === 'object'
        ? normalizeText((item as Record<string, unknown>).key) || label
        : label;

    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ key, label });
  }

  return normalized;
};

export const buildProfileInterestAreas = (configured: unknown): ProfileInterestArea[] => {
  const normalized = normalizeConfiguredInterestAreas(configured);

  if (normalized.length > 0) {
    return normalized.map((item) => ({
      ...item,
      custom: true,
      icon: BriefcaseIcon,
    }));
  }

  return INTEREST_AREAS.map((item) => ({ custom: false, icon: item.icon, key: item.key }));
};
