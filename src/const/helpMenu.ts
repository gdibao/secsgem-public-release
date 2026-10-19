import { sanitizeLinkUrl } from '@lobechat/utils';

export const HELP_MENU_ACTIONS = [
  'url',
  'feedback',
  'changelog',
  'settings',
  'eval',
  'product-hunt',
] as const;

export const HELP_MENU_ICONS = [
  'book',
  'feather',
  'discord',
  'file-clock',
  'github',
  'flask',
  'rocket',
  'settings',
  'help',
  'message',
] as const;

export type HelpMenuAction = (typeof HELP_MENU_ACTIONS)[number];
export type HelpMenuIcon = (typeof HELP_MENU_ICONS)[number];

export type HelpMenuItem = {
  action: HelpMenuAction;
  enabled: boolean;
  icon: HelpMenuIcon;
  key: string;
  label: string;
  url?: string;
};

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isHelpMenuAction = (value: string): value is HelpMenuAction =>
  (HELP_MENU_ACTIONS as readonly string[]).includes(value);

const isHelpMenuIcon = (value: string): value is HelpMenuIcon =>
  (HELP_MENU_ICONS as readonly string[]).includes(value);

const normalizeAction = (value: unknown): HelpMenuAction => {
  const action = normalizeText(value);

  return isHelpMenuAction(action) ? action : 'url';
};

const normalizeIcon = (value: unknown, action: HelpMenuAction): HelpMenuIcon => {
  const icon = normalizeText(value);

  if (isHelpMenuIcon(icon)) return icon;

  switch (action) {
    case 'feedback': {
      return 'feather';
    }
    case 'changelog': {
      return 'file-clock';
    }
    case 'settings': {
      return 'settings';
    }
    case 'eval': {
      return 'flask';
    }
    case 'product-hunt': {
      return 'rocket';
    }
    default: {
      return 'help';
    }
  }
};

const normalizeKey = (value: unknown, label: string, index: number) =>
  normalizeText(value) ||
  label
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') ||
  `item-${index + 1}`;

export const normalizeHelpMenuItems = (items: unknown): HelpMenuItem[] =>
  Array.isArray(items)
    ? items
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => {
          const raw = item as Record<string, unknown>;
          const label = normalizeText(raw.label);
          const url = sanitizeLinkUrl(raw.url);
          const action = normalizeAction(raw.action);

          return {
            action,
            enabled: raw.enabled !== false,
            icon: normalizeIcon(raw.icon, action),
            key: normalizeKey(raw.key, label, index),
            label,
            ...(url ? { url } : {}),
          };
        })
        .filter((item) => item.enabled && item.label)
    : [];
