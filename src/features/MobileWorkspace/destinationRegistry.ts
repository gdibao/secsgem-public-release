export type MobileDestinationScope = 'global' | 'personal' | 'workspace';

export interface MobileDestination {
  configurable: boolean;
  path: string;
  scope: MobileDestinationScope;
}

const MOBILE_DESTINATIONS: ReadonlyArray<{
  configurable: boolean;
  pattern: RegExp;
  scope: MobileDestinationScope;
}> = [
  { configurable: true, pattern: /^\/$/, scope: 'workspace' },
  { configurable: true, pattern: /^\/design\/?$/, scope: 'workspace' },
  { configurable: true, pattern: /^\/engineering-tools\/?$/, scope: 'workspace' },
  { configurable: true, pattern: /^\/apps\/?$/, scope: 'workspace' },
  { configurable: true, pattern: /^\/tasks\/?$/, scope: 'workspace' },
  {
    configurable: true,
    pattern: /^\/settings(?:\/(?:general|members|plans|billing|credits|usage))?\/?$/,
    scope: 'personal',
  },
  { configurable: true, pattern: /^\/discover\/?$/, scope: 'global' },
  { configurable: true, pattern: /^\/discover\/skill\/?$/, scope: 'global' },
  { configurable: true, pattern: /^\/community\/?$/, scope: 'global' },
  { configurable: false, pattern: /^\/design\/.*$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/apps\/.*$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/community\/.*$/, scope: 'global' },
  { configurable: false, pattern: /^\/page(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/image(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/ppt(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/agent(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/group(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/task(?:\/.*)?$/, scope: 'workspace' },
  { configurable: false, pattern: /^\/me(?:\/.*)?$/, scope: 'personal' },
  {
    configurable: false,
    pattern: /^\/settings\/(?:profile|llm|memory)(?:\/.*)?$/,
    scope: 'personal',
  },
];

const normalizeDestinationPath = (value: string) => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return;

  try {
    const url = new URL(value, 'https://mobile-destination.invalid');
    if (url.origin !== 'https://mobile-destination.invalid') return;
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return;
  }
};

export const resolveMobileDestination = (value: string): MobileDestination | undefined => {
  const path = normalizeDestinationPath(value);
  if (!path) return;
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === '/engineering-tools' && path !== pathname &&
    !/^\/engineering-tools\?view=(?:catalog|favorites|local_mcp)$/.test(path)) return;
  const match = MOBILE_DESTINATIONS.find((destination) => destination.pattern.test(pathname));
  return match ? { configurable: match.configurable, path, scope: match.scope } : undefined;
};

export const isMobileConfigurableDestination = (value: string) =>
  resolveMobileDestination(value)?.configurable === true;

export const mobileNavigateOptions = (value: string) => {
  const scope = resolveMobileDestination(value)?.scope;
  return scope === 'workspace' ? undefined : ({ escape: true } as const);
};
