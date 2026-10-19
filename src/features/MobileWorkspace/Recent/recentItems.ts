import type { SidebarAgentItem } from '@/database/repositories/home';
import type { RecentItem } from '@/server/routers/lambda/recent';

export interface MobileRecentConversation {
  avatar?: SidebarAgentItem['avatar'];
  backgroundColor?: SidebarAgentItem['backgroundColor'];
  id: string;
  kind: SidebarAgentItem['type'];
  pinned: boolean;
  routePath: string;
  sessionId: string;
  title: string;
  topicTitle?: string;
  unreadCount?: number;
  updatedAt: Date;
}

export interface MobileRecentSections {
  pinned: MobileRecentConversation[];
  recent: MobileRecentConversation[];
}

export type MobileRecentTimeKind = 'date' | 'justNow' | 'today' | 'yesterday';

export const getMobileRecentTimeKind = (value: Date, now = new Date()): MobileRecentTimeKind => {
  const elapsed = now.getTime() - value.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return 'justNow';

  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.floor((startOfDay(now) - startOfDay(value)) / 86_400_000);
  if (dayDifference === 0) return 'today';
  if (dayDifference === 1) return 'yesterday';
  return 'date';
};

interface BuildMobileRecentItemsInput {
  assistants: SidebarAgentItem[];
  recents: RecentItem[];
}

interface RecentParent {
  id: string;
  kind: SidebarAgentItem['type'];
}

const assistantKey = ({ id, kind }: RecentParent) => `${kind}:${id}`;

const assistantTitle = (assistant: SidebarAgentItem) => {
  const title = assistant.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return assistant.type === 'group' ? 'Untitled Group' : 'Untitled Assistant';
};

const parseRecentParent = (item: RecentItem): RecentParent | undefined => {
  try {
    const url = new URL(item.routePath, 'https://mobile.local');
    const [kind, routeId] = url.pathname.split('/').filter(Boolean);
    if (kind === 'group' && routeId) return { id: routeId, kind: 'group' };
    if (kind === 'agent') {
      const id = item.agentId || routeId;
      if (id) return { id, kind: 'agent' };
    }
  } catch {
    return;
  }
};

const byNewest = (left: MobileRecentConversation, right: MobileRecentConversation) =>
  right.updatedAt.getTime() - left.updatedAt.getTime();

export const buildMobileRecentItems = ({
  assistants,
  recents,
}: BuildMobileRecentItemsInput): MobileRecentSections => {
  const latestTopicByAssistant = new Map<string, RecentItem>();

  for (const item of recents) {
    if (item.type !== 'topic') continue;
    const parent = parseRecentParent(item);
    if (!parent) continue;

    const key = assistantKey(parent);
    const current = latestTopicByAssistant.get(key);
    if (!current || item.updatedAt.getTime() > current.updatedAt.getTime()) {
      latestTopicByAssistant.set(key, item);
    }
  }

  const seenAssistantKeys = new Set<string>();
  const items = assistants
    .filter((assistant) => {
      const key = assistantKey({ id: assistant.id, kind: assistant.type });
      if (seenAssistantKeys.has(key)) return false;
      seenAssistantKeys.add(key);
      return true;
    })
    .map((assistant): MobileRecentConversation => {
      const latestTopic = latestTopicByAssistant.get(
        assistantKey({ id: assistant.id, kind: assistant.type }),
      );
      const rootRoute =
        assistant.type === 'group' ? `/group/${assistant.id}` : `/agent/${assistant.id}`;

      return {
        avatar: assistant.avatar ?? undefined,
        backgroundColor: assistant.backgroundColor ?? undefined,
        id: assistant.id,
        kind: assistant.type,
        pinned: assistant.pinned,
        routePath: assistant.pinned ? rootRoute : (latestTopic?.routePath ?? rootRoute),
        sessionId: assistant.id,
        title: assistantTitle(assistant),
        topicTitle: latestTopic?.title.trim() || undefined,
        unreadCount: assistant.unreadCount,
        updatedAt: latestTopic?.updatedAt ?? assistant.updatedAt,
      };
    });

  const pinned = items
    .filter((item) => item.pinned)
    .sort((left, right) => {
      const typeOrder = Number(left.kind === 'group') - Number(right.kind === 'group');
      return typeOrder || byNewest(left, right);
    });
  const recent = items.filter((item) => !item.pinned).sort(byNewest);

  return { pinned, recent };
};

export const filterMobileRecentItems = (
  sections: MobileRecentSections,
  rawQuery: string,
): MobileRecentSections => {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return sections;
  const matches = (item: MobileRecentConversation) =>
    item.title.toLocaleLowerCase().includes(query) ||
    item.topicTitle?.toLocaleLowerCase().includes(query);
  return {
    pinned: sections.pinned.filter(matches),
    recent: sections.recent.filter(matches),
  };
};
