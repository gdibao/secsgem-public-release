import { CreateAgentSchema } from '@lobechat/types';

import capabilities from './capabilities.json';
import source from './catalog.json';
import { getFabOfflinePluginEntries, getFabRoleSkillProfile } from './offlineProfile';

export const localAssistants = source;
export const recommendedLocalAssistants = localAssistants.filter((entry) =>
  entry.identifier.startsWith('c150-'),
);
export const legacyLocalAssistants = localAssistants.filter((entry) =>
  entry.identifier.startsWith('semi-'),
);
export const localDomains = capabilities.domains;
export const localRoles = capabilities.roles;
export const localRoleCategories = [...new Set(localRoles.map((role) => role.roleCategory))];
export const localBrands = [
  ...new Set(localRoles.flatMap((role) => (role.brand ? [role.brand] : []))),
].sort();
const fallbackAvatars = ['🧠', '🧪', '📐', '⚙️', '🔧', '📊', '🛰️', '🧭'];
export const resolveLocalMirrorAvatar = (avatar: string | undefined, iconKey: string) => {
  if (avatar && !/^https?:\/\//i.test(avatar)) return avatar;
  const hash = [...iconKey].reduce(
    (total, character) => total + (character.codePointAt(0) || 0),
    0,
  );
  return fallbackAvatars[hash % fallbackAvatars.length];
};
const roleByIdentifier = new Map(localRoles.map((role) => [role.identifier, role]));

export const filterLocalAssistants = (query = '', domain = '', category = '', brand = '') => {
  const needle = query.trim().toLocaleLowerCase();
  return localAssistants.filter((entry) => {
    const role = roleByIdentifier.get(entry.identifier);
    return (
      (!domain || role?.domainIds.includes(domain)) &&
      (!category || role?.roleCategory === category) &&
      (!brand || role?.brand === brand) &&
      [entry.identifier, entry.meta.title, entry.meta.description, ...entry.meta.tags]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
};
// Public same-origin path for the private quality mirror. A deployment may
// override this with another reverse-proxied path without exposing LAN IPs.
export const officialMarketUrl =
  process.env.NEXT_PUBLIC_FAB_LOCAL_MARKET_URL || 'https://fab.secsgem.com.cn/market/';

export const isLocalAssistantMarketPath = (pathname: string) =>
  /\/community\/agent(?:\/[^/]+)?\/?$/.test(pathname);

export const isLocalMarketOverviewPath = (pathname: string) => /\/community\/?$/.test(pathname);

export type LocalMarketKind = 'skills' | 'mcp' | 'models' | 'providers';

export const localMarketKindFromPath = (pathname: string): LocalMarketKind | undefined => {
  const match = pathname.match(/\/community\/(skill|mcp|model|provider)(?:\/[^/]+)?\/?$/);
  if (!match) return undefined;

  return {
    mcp: 'mcp',
    model: 'models',
    provider: 'providers',
    skill: 'skills',
  }[match[1] as 'skill' | 'mcp' | 'model' | 'provider'];
};

export const localMarketIdentifier = (identifier: string) => `local:fab.secsgem.com.cn:${identifier}`;

export const getLocalAssistantConfig = (identifier: string) => {
  const entry = localAssistants.find((item) => item.identifier === identifier);
  if (!entry) throw new Error('Unknown local assistant');

  // Legacy examples are question/answer pairs; native inference expects messages.
  const fewShots = (entry.config.fewShots as { question: string; answer: string }[]).flatMap(
    ({ question, answer }) => [
      { content: question, role: 'user' as const },
      { content: answer, role: 'assistant' as const },
    ],
  );

  return CreateAgentSchema.parse({
    avatar: entry.meta.avatar,
    backgroundColor: entry.meta.backgroundColor || undefined,
    description: entry.meta.description,
    fewShots,
    marketIdentifier: localMarketIdentifier(identifier),
    openingMessage: entry.config.openingMessage,
    openingQuestions: [...entry.config.openingQuestions],
    params: { ...entry.config.params },
    // Pin the global knowledge/skill tools and derive the remaining native
    // tools from this role's T-package list. Different roles therefore carry
    // different capability sets without claiming third-party SDKs exist.
    plugins: [
      ...getFabOfflinePluginEntries(identifier),
      ...entry.config.plugins.map((plugin) => ({
        identifier: plugin,
        mode: 'disabled' as const,
      })),
    ],
    systemRole: `${entry.config.systemRole}\n\n${getFabRoleSkillProfile(identifier)}`,
    tags: [...entry.meta.tags],
    title: entry.meta.title,
    visibility: 'private',
  });
};
