export const ENGINEERING_TOOL_ROUTE = '/engineering-tools';

export const ENGINEERING_TOOL_DESTINATIONS = {
  catalog: '/engineering-tools?view=catalog',
  favorites: '/engineering-tools?view=favorites',
  local_mcp: '/engineering-tools?view=local_mcp',
} as const;

export type EngineeringToolDestinationKey = keyof typeof ENGINEERING_TOOL_DESTINATIONS;

type MenuEntry = {
  enabled: boolean;
  key: string;
  label: string;
  path: string;
  sortOrder: number;
};

const LEGACY_ENTRY_MAP = {
  image: { key: 'catalog', label: '工具目录', path: ENGINEERING_TOOL_DESTINATIONS.catalog },
  ppt: { key: 'favorites', label: '我的收藏', path: ENGINEERING_TOOL_DESTINATIONS.favorites },
  community: { key: 'local_mcp', label: '本地工具与 MCP', path: ENGINEERING_TOOL_DESTINATIONS.local_mcp },
} as const;

export const resolveEngineeringToolMenu = (menu: readonly MenuEntry[] | null | undefined) => {
  const entries = menu?.filter(
    (item): item is MenuEntry & { key: EngineeringToolDestinationKey } =>
      item.key in ENGINEERING_TOOL_DESTINATIONS &&
      item.path === ENGINEERING_TOOL_DESTINATIONS[item.key as EngineeringToolDestinationKey],
  );

  if (entries?.length) return [...entries].sort((a, b) => a.sortOrder - b.sortOrder);

  // Existing deployments still publish section-based rows. Project all three
  // slots while retaining admin-controlled order and enabled state. The old
  // section labels cannot describe the new destinations accurately.
  return menu?.flatMap((item) => {
    const mapped = LEGACY_ENTRY_MAP[item.key as keyof typeof LEGACY_ENTRY_MAP];
    return mapped ? [{ ...mapped, enabled: item.enabled, sortOrder: item.sortOrder }] : [];
  }).sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
};
