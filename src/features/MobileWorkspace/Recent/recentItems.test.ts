import { describe, expect, it } from 'vitest';

import type { SidebarAgentItem } from '@/database/repositories/home';
import type { RecentItem } from '@/server/routers/lambda/recent';

import {
  buildMobileRecentItems,
  filterMobileRecentItems,
  getMobileRecentTimeKind,
} from './recentItems';

const assistant = (
  id: string,
  type: SidebarAgentItem['type'],
  options: { pinned?: boolean; title: string; updatedAt: string },
): SidebarAgentItem => ({
  id,
  pinned: options.pinned ?? false,
  title: options.title,
  type,
  updatedAt: new Date(options.updatedAt),
});

const recentTopic = (
  id: string,
  routePath: string,
  updatedAt: string,
  agentId?: string | null,
): RecentItem => ({
  agentId,
  icon: 'topic',
  id,
  routePath,
  status: null,
  title: id,
  type: 'topic',
  updatedAt: new Date(updatedAt),
});

describe('buildMobileRecentItems', () => {
  it('mirrors the desktop assistant list and merges each latest topic into its parent row', () => {
    const pinnedAgent = assistant('agent-pinned', 'agent', {
      pinned: true,
      title: 'Pinned Agent',
      updatedAt: '2026-07-18T08:00:00.000Z',
    });
    const pinnedGroup = assistant('group-pinned', 'group', {
      pinned: true,
      title: 'Pinned Group',
      updatedAt: '2026-07-19T08:00:00.000Z',
    });
    const freeAgent = assistant('agent-free', 'agent', {
      title: 'Free Agent',
      updatedAt: '2026-07-17T08:00:00.000Z',
    });
    freeAgent.avatar = 'agent-avatar.png';
    freeAgent.backgroundColor = '#ffffff';
    freeAgent.unreadCount = 3;
    const idleAgent = assistant('agent-idle', 'agent', {
      title: 'Idle Agent',
      updatedAt: '2026-07-16T08:00:00.000Z',
    });
    const freeGroup = assistant('group-free', 'group', {
      title: 'Free Group',
      updatedAt: '2026-07-17T07:00:00.000Z',
    });

    const result = buildMobileRecentItems({
      assistants: [pinnedGroup, pinnedAgent, freeAgent, idleAgent, freeGroup],
      recents: [
        recentTopic(
          'pinned-agent-topic',
          '/agent/agent-pinned?topic=pinned-agent-topic',
          '2026-07-19T12:00:00.000Z',
          'agent-pinned',
        ),
        recentTopic(
          'newer-topic',
          '/agent/agent-free?topic=newer-topic',
          '2026-07-19T10:00:00.000Z',
          'agent-free',
        ),
        recentTopic(
          'older-topic',
          '/agent/agent-free?topic=older-topic',
          '2026-07-18T10:00:00.000Z',
          'agent-free',
        ),
        recentTopic(
          'group-topic',
          '/group/group-free?topic=group-topic',
          '2026-07-19T09:00:00.000Z',
        ),
      ],
    });

    expect(result.pinned.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'agent:agent-pinned',
      'group:group-pinned',
    ]);
    expect(result.pinned[0]).toMatchObject({
      routePath: '/agent/agent-pinned',
      title: 'Pinned Agent',
      topicTitle: 'pinned-agent-topic',
    });
    expect(result.recent.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'agent:agent-free',
      'group:group-free',
      'agent:agent-idle',
    ]);
    expect(result.recent[0]).toMatchObject({
      avatar: 'agent-avatar.png',
      backgroundColor: '#ffffff',
      routePath: '/agent/agent-free?topic=newer-topic',
      title: 'Free Agent',
      topicTitle: 'newer-topic',
      unreadCount: 3,
    });
    expect(result.recent[2]).toMatchObject({
      routePath: '/agent/agent-idle',
      title: 'Idle Agent',
      topicTitle: undefined,
    });
  });

  it('removes duplicate desktop items and ignores orphan topic records', () => {
    const agent = assistant('agent-free', 'agent', {
      title: 'Free Agent',
      updatedAt: '2026-07-17T08:00:00.000Z',
    });

    const result = buildMobileRecentItems({
      assistants: [agent, agent],
      recents: [
        recentTopic(
          'valid-topic',
          '/agent/agent-free?topic=valid-topic',
          '2026-07-19T10:00:00.000Z',
          'agent-free',
        ),
        recentTopic(
          'missing-parent',
          '/agent/missing?topic=missing-parent',
          '2026-07-19T09:00:00.000Z',
          'missing',
        ),
        recentTopic('orphan', '/', '2026-07-19T08:00:00.000Z'),
      ],
    });

    expect(result.recent).toHaveLength(1);
    expect(result.recent[0]).toMatchObject({ id: 'agent-free', topicTitle: 'valid-topic' });
  });
});

describe('filterMobileRecentItems', () => {
  it('matches both the desktop assistant name and latest topic title', () => {
    const sections = buildMobileRecentItems({
      assistants: [
        assistant('agent-free', 'agent', {
          title: 'Writing Assistant',
          updatedAt: '2026-07-17T08:00:00.000Z',
        }),
      ],
      recents: [
        recentTopic(
          'Quarterly Review',
          '/agent/agent-free?topic=quarterly-review',
          '2026-07-19T10:00:00.000Z',
          'agent-free',
        ),
      ],
    });

    expect(filterMobileRecentItems(sections, 'writing').recent).toHaveLength(1);
    expect(filterMobileRecentItems(sections, 'quarterly').recent).toHaveLength(1);
  });
});

describe('getMobileRecentTimeKind', () => {
  const now = new Date('2026-07-21T12:00:00.000Z');

  it.each([
    ['justNow', '2026-07-21T11:59:30.000Z'],
    ['today', '2026-07-21T08:00:00.000Z'],
    ['yesterday', '2026-07-20T10:00:00.000Z'],
    ['date', '2026-07-19T10:00:00.000Z'],
  ] as const)('classifies %s timestamps', (kind, value) => {
    expect(getMobileRecentTimeKind(new Date(value), now)).toBe(kind);
  });
});
