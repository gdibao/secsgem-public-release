import { CreateAgentSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  filterLocalAssistants,
  getLocalAssistantConfig,
  isLocalAssistantMarketPath,
  isLocalMarketOverviewPath,
  legacyLocalAssistants,
  localAssistants,
  localDomains,
  localMarketIdentifier,
  localMarketKindFromPath,
  recommendedLocalAssistants,
  resolveLocalMirrorAvatar,
} from './catalog';
import { getFabOfflinePluginEntries, getFabRoleSkillProfile } from './offlineProfile';

describe('published assistant native catalog', () => {
  it('contains the 150 recommendations plus the 45 legacy assistants', () => {
    expect(localAssistants).toHaveLength(195);
    expect(recommendedLocalAssistants).toHaveLength(150);
    expect(legacyLocalAssistants).toHaveLength(45);
    expect(new Set(localAssistants.map((entry) => entry.identifier)).size).toBe(195);
    expect(new Set(localAssistants.map((entry) => entry.sourceId)).size).toBe(195);
  });

  it.each(localAssistants)(
    '$identifier preserves content and satisfies the actual native schema',
    (entry) => {
      const config = getLocalAssistantConfig(entry.identifier);
      expect(CreateAgentSchema.strict().parse(config)).toEqual(config);
      expect(config.systemRole).toContain(entry.config.systemRole);
      expect(config.systemRole).toContain('本地已绑定能力');
      expect(config.title).toBe(entry.meta.title);
      expect(config.openingMessage).toBe(entry.config.openingMessage);
      expect(config.openingQuestions).toEqual(entry.config.openingQuestions);
      expect(config.fewShots).toEqual(
        entry.config.fewShots.flatMap(({ question, answer }) => [
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ]),
      );
      expect(config).not.toHaveProperty('model');
      expect(config).not.toHaveProperty('provider');
      expect(config).not.toHaveProperty('userId');
      expect(config).not.toHaveProperty('id');
      expect(config.plugins).toEqual([
        ...getFabOfflinePluginEntries(entry.identifier),
        ...entry.config.plugins.map((plugin) => ({
          identifier: plugin,
          mode: 'disabled',
        })),
      ]);
      expect(config.visibility).toBe('private');
      expect(entry.config.systemRole.length).toBeGreaterThan(400);
    },
  );

  it('pins only bundled offline runtime dependencies and no credentials', () => {
    expect(
      localAssistants.every(
        (entry) => (getLocalAssistantConfig(entry.identifier).plugins?.length ?? 0) > 0,
      ),
    ).toBe(true);
    const gas = getLocalAssistantConfig('c150-d04');
    const plc = getLocalAssistantConfig('c150-d25');
    expect(gas.plugins).toEqual(getFabOfflinePluginEntries('c150-d04'));
    expect(plc.plugins).toEqual(getFabOfflinePluginEntries('c150-d25'));
    expect(gas.plugins).not.toEqual(plc.plugins);
    expect(getFabRoleSkillProfile('c150-d04')).toContain('S04 特气工艺');
    expect(getFabRoleSkillProfile('c150-d25')).toContain('S11 PLC 与联锁逻辑');
    expect(JSON.stringify(localAssistants)).not.toMatch(
      /Bearer |apiKey|access_token|user_id|X-Casdoor-User|sessionId/,
    );
  });

  it('matches the 54/24/72 roster, 18 domains, role and brand filters', () => {
    expect(localAssistants.filter((row) => row.sourceId.startsWith('D'))).toHaveLength(54);
    expect(localAssistants.filter((row) => row.sourceId.startsWith('G'))).toHaveLength(24);
    expect(localAssistants.filter((row) => row.sourceId.startsWith('V'))).toHaveLength(72);
    expect(localDomains).toHaveLength(18);
    for (const domain of localDomains)
      expect(filterLocalAssistants('', domain.id).length).toBeGreaterThan(0);
    expect(filterLocalAssistants('', '', '领域岗位')).toHaveLength(54);
    expect(filterLocalAssistants('', '', '', 'ABB').length).toBeGreaterThan(0);
    expect(localMarketIdentifier('c150-d01')).toBe('local:fab.secsgem.com.cn:c150-d01');
  });

  it('does not share mutable installed configuration between users', () => {
    const one = getLocalAssistantConfig('c150-d04');
    one.openingQuestions!.push('user customization');
    expect(getLocalAssistantConfig('c150-d04').openingQuestions).not.toContain(
      'user customization',
    );
  });

  it('keeps local avatars and replaces remote mirror avatars with a stable local fallback', () => {
    expect(resolveLocalMirrorAvatar('🧪', 'local:test')).toBe('🧪');
    expect(resolveLocalMirrorAvatar('https://app.lobehub.com/f/file_example', 'local:test')).toBe(
      resolveLocalMirrorAvatar(undefined, 'local:test'),
    );
  });

  it('rejects unknown and traversal identifiers', () => {
    expect(() => getLocalAssistantConfig('../private')).toThrow('Unknown local assistant');
  });

  it.each([
    '/community/agent',
    '/team/community/agent/c150-d04',
    '/community/agent/upstream-agent',
  ])('uses local entry at %s', (path) => {
    expect(isLocalAssistantMarketPath(path)).toBe(true);
  });

  it.each(['/community', '/community/', '/agent/my-private-agent', '/community/mcp'])(
    'leaves unrelated path %s intact',
    (path) => {
      expect(isLocalAssistantMarketPath(path)).toBe(false);
    },
  );

  it('routes the local market overview and card catalogs internally', () => {
    expect(isLocalMarketOverviewPath('/community')).toBe(true);
    expect(isLocalMarketOverviewPath('/community/')).toBe(true);
    expect(localMarketKindFromPath('/community/skill')).toBe('skills');
    expect(localMarketKindFromPath('/community/skill/legacy-upstream-skill')).toBe('skills');
    expect(localMarketKindFromPath('/community/mcp')).toBe('mcp');
    expect(localMarketKindFromPath('/community/mcp/legacy-upstream-mcp')).toBe('mcp');
    expect(localMarketKindFromPath('/community/model')).toBe('models');
    expect(localMarketKindFromPath('/community/provider')).toBe('providers');
    expect(localMarketKindFromPath('/market/quality/skills/')).toBeUndefined();
  });
});
