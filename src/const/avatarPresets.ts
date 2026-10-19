export type AvatarPreset = {
  label: string;
  value: string;
};

export const DEFAULT_AVATAR_PRESETS: AvatarPreset[] = [
  { label: '驰拓绿', value: '/images/avatar-presets/avatar-1.svg' },
  { label: '驰拓紫', value: '/images/avatar-presets/avatar-2.svg' },
  { label: '晨光橙', value: '/images/avatar-presets/avatar-3.svg' },
  { label: '湖蓝', value: '/images/avatar-presets/avatar-4.svg' },
  { label: '玫红', value: '/images/avatar-presets/avatar-5.svg' },
  { label: '曜石', value: '/images/avatar-presets/avatar-6.svg' },
];

export const normalizeAvatarPresets = (value: unknown): AvatarPreset[] => {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: AvatarPreset[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const presetValue = typeof record.value === 'string' ? record.value.trim() : '';

    if (!label || !presetValue || seen.has(presetValue)) continue;
    seen.add(presetValue);
    normalized.push({ label, value: presetValue });
  }

  return normalized.length > 0 ? normalized : DEFAULT_AVATAR_PRESETS;
};
