import { CreateAgentSchema } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localAssistants, localMarketIdentifier, recommendedLocalAssistants } from './catalog';
import { installLocalAssistant } from './install';

const fixture = vi.hoisted(() => ({
  user: 'ordinary-a',
  workspace: 'personal',
  rows: [] as any[],
  create: vi.fn(),
  getConfig: vi.fn(),
  update: vi.fn(),
  provisionFabOfflineKnowledge: vi.fn(),
  lookup: vi.fn(),
}));

// Only the transport is replaced. The real AgentService and native schema run.
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agent: {
      createAgent: { mutate: fixture.create },
      getAgentConfigById: { query: fixture.getConfig },
      updateAgentConfig: { mutate: fixture.update },
      getAgentByMarketIdentifier: { query: fixture.lookup },
    },
    connector: {
      provisionFabOfflineKnowledge: {
        mutate: fixture.provisionFabOfflineKnowledge,
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.user = 'ordinary-a';
  fixture.workspace = 'personal';
  fixture.rows = [
    {
      id: 'custom',
      userId: 'ordinary-a',
      title: 'My custom assistant',
      systemRole: 'Keep me',
    },
  ];
  fixture.lookup.mockImplementation(async ({ marketIdentifier, ownedPrivateOnly }) => {
    if (!fixture.user) throw new Error('UNAUTHORIZED');
    return (
      fixture.rows.find(
        (row) =>
          (ownedPrivateOnly
            ? row.userId === fixture.user && row.visibility === 'private'
            : row.userId === fixture.user || row.visibility === 'public') &&
          row.workspace === fixture.workspace &&
          row.marketIdentifier === marketIdentifier,
      )?.id ?? null
    );
  });
  fixture.create.mockImplementation(async ({ config, visibility }) => {
    if (!fixture.user) throw new Error('UNAUTHORIZED');
    const parsed = CreateAgentSchema.strict().parse(config);
    const agentId = `fixture-${fixture.rows.length}`;
    fixture.rows.push({
      ...parsed,
      id: agentId,
      userId: fixture.user,
      workspace: fixture.workspace,
      visibility,
    });
    return { agentId };
  });
  fixture.getConfig.mockImplementation(async ({ agentId }) => {
    const row = fixture.rows.find((item) => item.id === agentId);
    if (!row) throw new Error('NOT_FOUND');
    return row;
  });
  fixture.update.mockImplementation(async ({ agentId, value }) => {
    const row = fixture.rows.find((item) => item.id === agentId);
    if (row) Object.assign(row, value);
    return row;
  });
  fixture.provisionFabOfflineKnowledge.mockResolvedValue({
    connectorId: 'connector-1',
    toolCount: 1,
  });
});

describe('ordinary-user installation through native AgentService', () => {
  it('installs all 150 through native create with private ownership and preserves custom assistants', async () => {
    for (const entry of recommendedLocalAssistants)
      await installLocalAssistant(entry.identifier, fixture.user);
    expect(fixture.create).toHaveBeenCalledTimes(150);
    expect(fixture.provisionFabOfflineKnowledge).toHaveBeenCalledTimes(150);
    expect(fixture.rows).toHaveLength(151);
    expect(fixture.rows[0]).toEqual({
      id: 'custom',
      userId: 'ordinary-a',
      title: 'My custom assistant',
      systemRole: 'Keep me',
    });
    expect(
      fixture.rows
        .slice(1)
        .every((row) => row.visibility === 'private' && row.userId === 'ordinary-a'),
    ).toBe(true);
  });

  it('reopens an existing private copy without overwriting user edits', async () => {
    const first = await installLocalAssistant('c150-d04', fixture.user);
    fixture.rows[1].systemRole = 'User edited this prompt';
    const second = await installLocalAssistant('c150-d04', fixture.user);
    expect(second).toEqual(first);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.provisionFabOfflineKnowledge).toHaveBeenCalledTimes(2);
    expect(fixture.rows[1].systemRole).toBe('User edited this prompt');
  });

  it('requests owned-private filtering so newer shared copies cannot hide user edits', async () => {
    const first = await installLocalAssistant(localAssistants[0].identifier, fixture.user);
    fixture.rows[1].systemRole = 'my edits';
    fixture.rows.unshift({
      id: 'newer-shared',
      userId: 'bob',
      visibility: 'public',
      workspace: fixture.workspace,
      marketIdentifier: localMarketIdentifier(localAssistants[0].identifier),
    });
    expect(await installLocalAssistant(localAssistants[0].identifier, fixture.user)).toEqual(first);
    expect(fixture.lookup).toHaveBeenLastCalledWith({
      marketIdentifier: localMarketIdentifier(localAssistants[0].identifier),
      ownedPrivateOnly: true,
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.provisionFabOfflineKnowledge).toHaveBeenCalledTimes(2);
    expect(fixture.rows[2].systemRole).toBe('my edits');
  });

  it('creates separate copies for two ordinary users and for distinct workspaces', async () => {
    const a = await installLocalAssistant('c150-d04', fixture.user);
    fixture.user = 'ordinary-b';
    const b = await installLocalAssistant('c150-d04', fixture.user);
    fixture.workspace = 'workspace-b';
    const c = await installLocalAssistant('c150-d04', fixture.user);
    expect(new Set([a.agentId, b.agentId, c.agentId]).size).toBe(3);
  });

  it('does not adopt a shared workspace copy belonging to another user', async () => {
    fixture.rows.push({
      id: 'shared',
      userId: 'other-member',
      visibility: 'public',
      marketIdentifier: localMarketIdentifier('c150-d04'),
    });
    fixture.lookup.mockImplementation(async ({ ownedPrivateOnly }) =>
      ownedPrivateOnly ? null : 'shared',
    );
    const result = await installLocalAssistant('c150-d04', fixture.user);
    expect(result.agentId).not.toBe('shared');
    expect(fixture.rows[1].userId).toBe('other-member');
  });

  it('requires local login and never converts an auth failure to an external login', async () => {
    await expect(installLocalAssistant('c150-d04', '')).rejects.toThrow('sign-in');
    expect(fixture.lookup).not.toHaveBeenCalled();
    fixture.user = '';
    await expect(installLocalAssistant('c150-d04', 'stale-session')).rejects.toThrow(
      'UNAUTHORIZED',
    );
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.provisionFabOfflineKnowledge).not.toHaveBeenCalled();
  });

  it('propagates denied native creation without modifying existing rows', async () => {
    fixture.create.mockRejectedValue(new Error('FORBIDDEN'));
    await expect(installLocalAssistant('c150-d04', fixture.user)).rejects.toThrow('FORBIDDEN');
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.provisionFabOfflineKnowledge).not.toHaveBeenCalled();
  });
});
