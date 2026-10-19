import { describe, expect, it } from 'vitest';

import {
  normalizeAgentSkillListItem,
  normalizeMarketSkillItems,
  normalizeMcpMarketItems,
} from './normalizeMarketItems';

describe('normalizeMarketItems', () => {
  it('normalizes market skills that use title/avatar fields', () => {
    const result = normalizeMarketSkillItems([
      {
        avatar: 'skill-icon',
        description: 'Current market shape',
        identifier: 'skill-one',
        title: 'Skill One',
      } as any,
      {
        name: 'Broken Skill',
      } as any,
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        icon: 'skill-icon',
        identifier: 'skill-one',
        name: 'Skill One',
        title: 'Skill One',
      }),
    ]);
  });

  it('normalizes MCP market items and removes items without identifiers', () => {
    const result = normalizeMcpMarketItems([
      {
        identifier: 'mcp-one',
        summary: 'Summary text',
        title: 'MCP One',
      } as any,
      {
        title: 'Broken MCP',
      } as any,
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        description: 'Summary text',
        identifier: 'mcp-one',
        name: 'MCP One',
        title: 'MCP One',
      }),
    ]);
  });

  it('uses the database id as a last resort for installed agent skills', () => {
    const result = normalizeAgentSkillListItem({
      id: 'skill-id',
      source: 'market',
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        identifier: 'skill-id',
        name: 'skill-id',
      }),
    );
  });

  it('replaces placeholder UN labels with readable identifiers and description fallback', () => {
    const result = normalizeMcpMarketItems([
      {
        description: ' ',
        identifier: 'microsoft-playwright-mcp',
        name: 'UN',
      } as any,
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        description: '内容暂不可用',
        identifier: 'microsoft-playwright-mcp',
        name: 'microsoft-playwright-mcp',
      }),
    ]);
  });

  it('normalizes placeholder labels for installed agent skills', () => {
    const result = normalizeAgentSkillListItem({
      id: 'skill-id',
      identifier: 'market-skill',
      name: 'UN',
      source: 'market',
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        identifier: 'market-skill',
        name: 'market-skill',
      }),
    );
  });
});
