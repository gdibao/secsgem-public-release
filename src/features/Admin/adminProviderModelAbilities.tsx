import { Flexbox } from '@lobehub/ui';
import { Checkbox } from 'antd';

const ABILITY_KEYS = [
  'vision',
  'files',
  'imageOutput',
  'video',
  'audio',
  'functionCall',
  'reasoning',
  'search',
] as const;

export type AdminModelAbilityKey = (typeof ABILITY_KEYS)[number];

export type AdminModelAbilities = Partial<Record<AdminModelAbilityKey, boolean>>;

const getManualAbilities = (metadata?: Record<string, unknown> | null): AdminModelAbilities => {
  const value = metadata?.manualAbilities;
  if (!value || typeof value !== 'object') return {};

  return value as AdminModelAbilities;
};

export const buildManualAbilitiesMetadata = ({
  abilities,
  metadata,
}: {
  abilities: AdminModelAbilities;
  metadata?: Record<string, unknown> | null;
}) => ({
  ...(metadata ?? {}),
  manualAbilities: abilities,
});

export const AiProviderModelAbilitiesCell = ({
  metadata,
  onSave,
  t,
}: {
  metadata?: Record<string, unknown> | null;
  onSave: (abilities: AdminModelAbilities) => void;
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) => {
  const manualAbilities = getManualAbilities(metadata);

  return (
    <Checkbox.Group
      value={ABILITY_KEYS.filter((key) => manualAbilities[key])}
      onChange={(values) => {
        const selected = new Set(values as AdminModelAbilityKey[]);
        onSave(
          ABILITY_KEYS.reduce<AdminModelAbilities>((map, key) => {
            map[key] = selected.has(key);
            return map;
          }, {}),
        );
      }}
    >
      <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
        {ABILITY_KEYS.map((key) => (
          <Checkbox key={key} value={key}>
            {t(`admin.providers.models.abilities.${key}`, key)}
          </Checkbox>
        ))}
      </Flexbox>
    </Checkbox.Group>
  );
};
