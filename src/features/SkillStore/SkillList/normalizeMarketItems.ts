import type { SkillListItem } from '@lobechat/types';

import type { DiscoverMcpItem, DiscoverSkillItem } from '@/types/discover';

const EMPTY_DESCRIPTION_FALLBACK = '内容暂不可用';

const isPlaceholderText = (text: string) => text.toUpperCase() === 'UN';

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (isPlaceholderText(text)) continue;
    if (text) return text;
  }
};

const withDisplayFields = <T extends object>(item: T, fallbackIdentifier?: unknown) => {
  const raw = item as Record<string, unknown>;
  const identifier = firstText(raw.identifier, raw.slug, fallbackIdentifier);
  if (!identifier) return;

  const hasPlaceholderLabel = [raw.name, raw.title, raw.displayName].some(
    (value) => typeof value === 'string' && isPlaceholderText(value.trim()),
  );
  const hasDescriptionField = 'description' in raw || 'summary' in raw;
  const name = firstText(raw.name, raw.title, raw.displayName, identifier);
  const title = firstText(raw.title, raw.displayName);
  const description =
    firstText(raw.description, raw.summary) ||
    (hasDescriptionField || hasPlaceholderLabel ? EMPTY_DESCRIPTION_FALLBACK : undefined);
  const icon = firstText(raw.icon, raw.avatar);

  return {
    ...raw,
    ...(description ? { description } : {}),
    identifier,
    ...(icon ? { icon } : {}),
    name,
    ...(title ? { title } : {}),
  } as T;
};

export const normalizeMarketSkillItem = (item: DiscoverSkillItem) =>
  withDisplayFields(item) as DiscoverSkillItem | undefined;

export const normalizeMcpMarketItem = (item: DiscoverMcpItem) =>
  withDisplayFields(item) as DiscoverMcpItem | undefined;

export const normalizeAgentSkillListItem = (item: SkillListItem) =>
  withDisplayFields(item, item.id) as SkillListItem | undefined;

export const normalizeMarketSkillItems = (items: DiscoverSkillItem[] = []) =>
  items.map(normalizeMarketSkillItem).filter(Boolean) as DiscoverSkillItem[];

export const normalizeMcpMarketItems = (items: DiscoverMcpItem[] = []) =>
  items.map(normalizeMcpMarketItem).filter(Boolean) as DiscoverMcpItem[];

export const normalizeAgentSkillListItems = (items: SkillListItem[] = []) =>
  items.map(normalizeAgentSkillListItem).filter(Boolean) as SkillListItem[];
