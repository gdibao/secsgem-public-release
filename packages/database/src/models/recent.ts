import type { ChatTopicStatus, SidebarAgentItem, TaskStatus } from '@lobechat/types';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import { type AnyPgColumn, unionAll } from 'drizzle-orm/pg-core';
import removeMarkdown from 'remove-markdown';

import {
  agents,
  chatGroups,
  DOCUMENT_FOLDER_TYPE,
  documents,
  messages,
  tasks,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentMeta } from '../utils/inboxAgent';
import { notShareVisitorTopic } from '../utils/shareVisitor';
import { buildWorkspaceWhere } from '../utils/workspace';
import { ChatGroupModel } from './chatGroup';

export interface RecentDbItem {
  description?: string | null;
  id: string;
  lastAssistantMessage?: string | null;
  metadata?: any;
  routeGroupId: string | null;
  routeId: string | null;
  /** Task link slug source. This is the task name and never its instruction. */
  slugTitle?: string | null;
  /** Task lifecycle status when `type === 'task'`; null for topic/document. */
  status: TaskStatus | null;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
  /** The member who owns (created) this item — for author attribution in team views. */
  userId: string;
}

export type RecentItemType = RecentDbItem['type'];

export interface RecentTopicParentIds {
  agentIds: string[];
  groupIds: string[];
}

export interface MobileWorkspaceRecentDbItem {
  avatar?: SidebarAgentItem['avatar'];
  backgroundColor?: string | null;
  id: string;
  kind: SidebarAgentItem['type'];
  pinned: boolean;
  title: string;
  topic?: RecentDbItem;
  unreadCount: number;
  updatedAt: Date;
}

export interface MobileWorkspaceRecentQuery {
  cursor?: string;
  limit?: number;
  query?: string;
}

export interface MobileWorkspaceRecentResult {
  items: MobileWorkspaceRecentDbItem[];
  nextCursor?: string;
}

interface MobileWorkspaceParentRow {
  activityAt: Date;
  activityEpoch: string;
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  kind: SidebarAgentItem['type'];
  pinned: boolean;
  slug: string | null;
  title: string | null;
  updatedAt: Date;
}

interface MobileWorkspaceCursor {
  activityEpoch: string;
  id: string;
  kind: SidebarAgentItem['type'];
  pinned: boolean;
}

// Mirrors `MAIN_SIDEBAR_EXCLUDE_TRIGGERS` in `src/const/topic.ts` plus the
// legacy `task_manager` trigger from the previous Task Manager panel.
// System-trigger topics live in their own surfaces and would clutter Recent.
const SYSTEM_TOPIC_TRIGGERS = [
  'cron',
  'eval',
  'task_manager',
  'task',
  'document',
  'goal_supervision',
];

// Excluded so tool-owned document rows don't surface as generic recent docs;
// only user-authored pages ('api') and legacy 'topic' rows remain.
const TOOL_DOCUMENT_SOURCE_TYPES = ['agent', 'agent-signal', 'file', 'web'] as const;

const TASK_FINAL_STATUSES = ['completed', 'canceled'];
const TOPIC_INBOX_STATUSES: ChatTopicStatus[] = ['running', 'unread'];
const LAST_MESSAGE_PREVIEW_LENGTH = 2000;

const sharedParentWhere = (visibility: AnyPgColumn) =>
  or(isNull(visibility), eq(visibility, 'public'));

const decodeMobileWorkspaceCursor = (cursor?: string): MobileWorkspaceCursor | undefined => {
  if (!cursor) return;

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof decoded?.activityEpoch !== 'string' ||
      typeof decoded?.id !== 'string' ||
      (decoded?.kind !== 'agent' && decoded?.kind !== 'group') ||
      typeof decoded?.pinned !== 'boolean' ||
      !/^\d+$/.test(decoded.activityEpoch)
    ) {
      return;
    }
    return decoded as MobileWorkspaceCursor;
  } catch {
    return;
  }
};

const encodeMobileWorkspaceCursor = (item: MobileWorkspaceParentRow) =>
  Buffer.from(
    JSON.stringify({
      activityEpoch: item.activityEpoch,
      id: item.id,
      kind: item.kind,
      pinned: item.pinned,
    } satisfies MobileWorkspaceCursor),
  ).toString('base64url');

const compareMobileWorkspaceParents = (
  left: MobileWorkspaceParentRow,
  right: MobileWorkspaceParentRow,
) =>
  Number(right.pinned) - Number(left.pinned) ||
  (BigInt(right.activityEpoch) > BigInt(left.activityEpoch)
    ? 1
    : BigInt(right.activityEpoch) < BigInt(left.activityEpoch)
      ? -1
      : 0) ||
  left.kind.localeCompare(right.kind) ||
  left.id.localeCompare(right.id);

// Best-effort markdown → plain text; previews render in a plain-text row, so
// syntax noise (**, #, []() …) would show up literally.
const toPlainTextPreview = (markdown: string): string => {
  try {
    return removeMarkdown(markdown).trimEnd();
  } catch {
    return markdown;
  }
};

export class RecentModel {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  queryRecent = async (
    limit: number = 10,
    types?: RecentItemType[],
    withTopicPreview?: boolean,
    mineOnly?: boolean,
    /** Restrict a workspace feed to conversations visible to the whole team. */
    sharedOnly?: boolean,
  ): Promise<RecentDbItem[]> => {
    if (types?.length === 0) return [];
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    const requestedTypes = types ? new Set(types) : undefined;

    // `tasks` uses `createdByUserId` instead of `userId`, so apply the
    // workspace-aware predicate inline.
    const taskScopeWhere = this.workspaceId
      ? eq(tasks.workspaceId, this.workspaceId)
      : and(eq(tasks.createdByUserId, this.userId), isNull(tasks.workspaceId));

    // Workspace rows are shared across members; `mineOnly` narrows a workspace
    // feed back to the viewer's own items. A no-op in personal mode, where the
    // scope predicate already pins the user.
    const mineTopicWhere = mineOnly ? eq(topics.userId, this.userId) : undefined;
    const mineDocumentWhere = mineOnly ? eq(documents.userId, this.userId) : undefined;
    const mineTaskWhere = mineOnly ? eq(tasks.createdByUserId, this.userId) : undefined;

    const topicArm = this.db
      .select({
        description: withTopicPreview
          ? topics.description
          : sql<string | null>`NULL`.as('description'),
        id: topics.id,
        metadata: sql<any>`${topics.metadata}`.as('metadata'),
        routeGroupId: sql<string | null>`${topics.groupId}`.as('route_group_id'),
        routeId: sql<string | null>`${topics.agentId}`.as('route_id'),
        slugTitle: sql<string | null>`NULL`.as('slug_title'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title: sql<string>`COALESCE(${topics.title}, 'Untitled Topic')`.as('title'),
        type: sql<RecentDbItem['type']>`'topic'`.as('type'),
        updatedAt: topics.updatedAt,
        userId: topics.userId,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .leftJoin(chatGroups, eq(topics.groupId, chatGroups.id))
      .where(
        requestedTypes && !requestedTypes.has('topic')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, topics),
              // Agent-share visitor topics keep the creator's userId — never
              // surface a visitor's conversation in the creator's own Recent feed.
              notShareVisitorTopic(),
              mineTopicWhere,
              // Topic scope alone is insufficient: stale/mismatched rows can
              // point at a personal or foreign-workspace agent/group. Check
              // the parent scope before returning titles or loading previews.
              or(
                and(
                  isNotNull(topics.groupId),
                  buildWorkspaceWhere(scope, chatGroups),
                  this.workspaceId && sharedOnly
                    ? sharedParentWhere(chatGroups.visibility)
                    : undefined,
                ),
                and(
                  isNull(topics.groupId),
                  buildWorkspaceWhere(scope, agents),
                  this.workspaceId && sharedOnly ? sharedParentWhere(agents.visibility) : undefined,
                  or(eq(agents.slug, 'inbox'), ne(agents.virtual, true)),
                ),
              ),
              or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
              or(isNull(topics.status), not(inArray(topics.status, TOPIC_INBOX_STATUSES))),
            ),
      );

    const documentArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: documents.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`NULL`.as('route_id'),
        slugTitle: sql<string | null>`NULL`.as('slug_title'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title:
          sql<string>`COALESCE(${documents.title}, ${documents.filename}, 'Untitled Document')`.as(
            'title',
          ),
        type: sql<RecentDbItem['type']>`'document'`.as('type'),
        updatedAt: documents.updatedAt,
        userId: documents.userId,
      })
      .from(documents)
      .where(
        requestedTypes && !requestedTypes.has('document')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, documents),
              mineDocumentWhere,
              not(inArray(documents.sourceType, TOOL_DOCUMENT_SOURCE_TYPES)),
              isNull(documents.knowledgeBaseId),
              ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
            ),
      );

    const taskArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: tasks.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`${tasks.assigneeAgentId}`.as('route_id'),
        slugTitle: sql<string | null>`${tasks.name}`.as('slug_title'),
        status: sql<TaskStatus | null>`${tasks.status}`.as('status'),
        title: sql<string>`COALESCE(${tasks.name}, ${tasks.instruction}, 'Untitled Task')`.as(
          'title',
        ),
        type: sql<RecentDbItem['type']>`'task'`.as('type'),
        updatedAt: tasks.updatedAt,
        userId: sql<string>`${tasks.createdByUserId}`.as('user_id'),
      })
      .from(tasks)
      .where(
        requestedTypes && !requestedTypes.has('task')
          ? sql`false`
          : and(taskScopeWhere, mineTaskWhere, not(inArray(tasks.status, TASK_FINAL_STATUSES))),
      );

    const recentItems = unionAll(topicArm, documentArm, taskArm).as('recent_items');
    const rows = await this.db
      .select()
      .from(recentItems)
      .where(types ? inArray(recentItems.type, types) : undefined)
      .orderBy(desc(recentItems.updatedAt))
      .limit(limit);

    // Previews are fetched in a second batched query scoped to the final page
    // — inlining a correlated subquery in the topic arm would evaluate it for
    // every topic the user owns before the sort/limit prunes to `limit` rows.
    const previewByTopicId = withTopicPreview
      ? await this.queryLastAssistantPreviews(
          rows.filter((row) => row.type === 'topic').map((row) => row.id),
        )
      : new Map<string, string>();

    return rows.map((row) => {
      const preview = previewByTopicId.get(row.id) ?? null;
      return {
        description: row.description,
        id: row.id,
        lastAssistantMessage:
          preview && preview.length > LAST_MESSAGE_PREVIEW_LENGTH
            ? `${preview.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
            : preview,
        metadata: row.metadata ?? undefined,
        routeGroupId: row.routeGroupId,
        routeId: row.routeId,
        slugTitle: row.slugTitle,
        status: row.status,
        title: row.title,
        type: row.type,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any),
        userId: row.userId,
      };
    });
  };

  private queryLastAssistantPreviews = async (topicIds: string[]): Promise<Map<string, string>> => {
    if (topicIds.length === 0) return new Map();

    const rows = await this.db
      .selectDistinctOn([messages.topicId], {
        topicId: messages.topicId,
        value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.topicId, topicIds),
          eq(messages.role, 'assistant'),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
          ne(messages.content, ''),
        ),
      )
      .orderBy(messages.topicId, desc(messages.createdAt));

    return new Map(
      rows
        .filter((row) => row.topicId !== null)
        .map((row) => [row.topicId!, toPlainTextPreview(row.value)]),
    );
  };

  queryMobileWorkspace = async ({
    cursor,
    limit = 20,
    query,
  }: MobileWorkspaceRecentQuery = {}): Promise<MobileWorkspaceRecentResult> => {
    const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    const decodedCursor = decodeMobileWorkspaceCursor(cursor);
    const keyword = query?.trim();

    const latestMessageAt = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), buildWorkspaceWhere(scope, messages)))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`GREATEST(${topics.updatedAt}, COALESCE((${latestMessageAt}), ${topics.updatedAt}))`.mapWith(
        topics.updatedAt,
      );
    const agentActivityQuery = this.db
      .select({ value: topicActivityAt })
      .from(topics)
      .where(
        and(
          buildWorkspaceWhere(scope, topics),
          eq(topics.agentId, agents.id),
          notShareVisitorTopic(),
          isNull(topics.groupId),
          or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
        ),
      )
      .orderBy(desc(topicActivityAt), desc(topics.updatedAt))
      .limit(1);
    const groupActivityQuery = this.db
      .select({ value: topicActivityAt })
      .from(topics)
      .where(
        and(
          buildWorkspaceWhere(scope, topics),
          eq(topics.groupId, chatGroups.id),
          notShareVisitorTopic(),
          or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
        ),
      )
      .orderBy(desc(topicActivityAt), desc(topics.updatedAt))
      .limit(1);
    const agentActivityAt =
      sql<Date>`GREATEST(${agents.updatedAt}, COALESCE((${agentActivityQuery}), ${agents.updatedAt}))`.mapWith(
        agents.updatedAt,
      );
    const groupActivityAt =
      sql<Date>`GREATEST(${chatGroups.updatedAt}, COALESCE((${groupActivityQuery}), ${chatGroups.updatedAt}))`.mapWith(
        chatGroups.updatedAt,
      );
    const agentPinned = sql<boolean>`COALESCE(${agents.pinned}, false)`;
    const groupPinned = sql<boolean>`COALESCE(${chatGroups.pinned}, false)`;
    const agentActivityEpoch = sql<string>`((EXTRACT(EPOCH FROM ${agentActivityAt}) * 1000000)::bigint)::text`;
    const groupActivityEpoch = sql<string>`((EXTRACT(EPOCH FROM ${groupActivityAt}) * 1000000)::bigint)::text`;

    const agentTopicSearchQuery = keyword
      ? this.db
          .select({ value: sql`1` })
          .from(topics)
          .where(
            and(
              buildWorkspaceWhere(scope, topics),
              eq(topics.agentId, agents.id),
              notShareVisitorTopic(),
              isNull(topics.groupId),
              ilike(topics.title, `%${keyword}%`),
              or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
            ),
          )
          .limit(1)
      : undefined;
    const groupTopicSearchQuery = keyword
      ? this.db
          .select({ value: sql`1` })
          .from(topics)
          .where(
            and(
              buildWorkspaceWhere(scope, topics),
              eq(topics.groupId, chatGroups.id),
              notShareVisitorTopic(),
              ilike(topics.title, `%${keyword}%`),
              or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
            ),
          )
          .limit(1)
      : undefined;

    const cursorWhere = (
      pinned: ReturnType<typeof sql<boolean>>,
      activityAt: ReturnType<typeof sql<Date>>,
      kind: SidebarAgentItem['type'],
      id: typeof agents.id | typeof chatGroups.id,
    ) => {
      if (!decodedCursor) return;
      const activityEpoch = sql<string>`(EXTRACT(EPOCH FROM ${activityAt}) * 1000000)::bigint`;
      const cursorEpoch = sql<string>`${decodedCursor.activityEpoch}::bigint`;
      const tieBreaker =
        kind > decodedCursor.kind
          ? sql`true`
          : kind === decodedCursor.kind
            ? sql`${id} > ${decodedCursor.id}`
            : sql`false`;
      const samePinnedTail = or(
        lt(activityEpoch, cursorEpoch),
        and(eq(activityEpoch, cursorEpoch), tieBreaker),
      );

      return decodedCursor.pinned
        ? or(eq(pinned, false), and(eq(pinned, true), samePinnedTail))
        : and(eq(pinned, false), samePinnedTail);
    };

    const [agentRows, groupRows] = await Promise.all([
      this.db
        .select({
          activityAt: agentActivityAt.as('activity_at'),
          activityEpoch: agentActivityEpoch.as('activity_epoch'),
          avatar: agents.avatar,
          backgroundColor: agents.backgroundColor,
          id: agents.id,
          kind: sql<SidebarAgentItem['type']>`'agent'`.as('kind'),
          pinned: agentPinned.as('pinned'),
          slug: agents.slug,
          title: agents.title,
          updatedAt: agents.updatedAt,
        })
        .from(agents)
        .where(
          and(
            buildWorkspaceWhere(scope, agents),
            or(eq(agents.slug, 'inbox'), not(eq(agents.virtual, true))),
            keyword
              ? or(ilike(agents.title, `%${keyword}%`), sql`EXISTS (${agentTopicSearchQuery!})`)
              : undefined,
            cursorWhere(agentPinned, agentActivityAt, 'agent', agents.id),
          ),
        )
        .orderBy(desc(agentPinned), desc(agentActivityAt), asc(agents.id))
        .limit(boundedLimit + 1),
      this.db
        .select({
          activityAt: groupActivityAt.as('activity_at'),
          activityEpoch: groupActivityEpoch.as('activity_epoch'),
          avatar: chatGroups.avatar,
          backgroundColor: chatGroups.backgroundColor,
          id: chatGroups.id,
          kind: sql<SidebarAgentItem['type']>`'group'`.as('kind'),
          pinned: groupPinned.as('pinned'),
          slug: sql<string | null>`NULL`.as('slug'),
          title: chatGroups.title,
          updatedAt: chatGroups.updatedAt,
        })
        .from(chatGroups)
        .where(
          and(
            buildWorkspaceWhere(scope, chatGroups),
            keyword
              ? or(ilike(chatGroups.title, `%${keyword}%`), sql`EXISTS (${groupTopicSearchQuery!})`)
              : undefined,
            cursorWhere(groupPinned, groupActivityAt, 'group', chatGroups.id),
          ),
        )
        .orderBy(desc(groupPinned), desc(groupActivityAt), asc(chatGroups.id))
        .limit(boundedLimit + 1),
    ]);

    const parents = [...agentRows, ...groupRows]
      .map((row): MobileWorkspaceParentRow => ({
        ...row,
        activityAt:
          row.activityAt instanceof Date
            ? row.activityAt
            : new Date(row.activityAt as unknown as string),
        activityEpoch: String(row.activityEpoch),
        kind: row.kind as SidebarAgentItem['type'],
        pinned: Boolean(row.pinned),
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt
            : new Date(row.updatedAt as unknown as string),
      }))
      .sort(compareMobileWorkspaceParents);
    const hasMore = parents.length > boundedLimit;
    const page = parents.slice(0, boundedLimit);
    const agentIds = page.filter((item) => item.kind === 'agent').map((item) => item.id);
    const groupIds = page.filter((item) => item.kind === 'group').map((item) => item.id);

    const [latestTopics, agentUnreadRows, groupUnreadRows, groupAvatarMap] = await Promise.all([
      this.queryLatestTopicsByParents({ agentIds, groupIds }),
      agentIds.length
        ? this.db
            .select({ id: topics.agentId, value: count() })
            .from(topics)
            .where(
              and(
                buildWorkspaceWhere(scope, topics),
                eq(topics.status, 'unread'),
                notShareVisitorTopic(),
                inArray(topics.agentId, agentIds),
                or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
              ),
            )
            .groupBy(topics.agentId)
        : [],
      groupIds.length
        ? this.db
            .select({ id: topics.groupId, value: count() })
            .from(topics)
            .where(
              and(
                buildWorkspaceWhere(scope, topics),
                eq(topics.status, 'unread'),
                notShareVisitorTopic(),
                inArray(topics.groupId, groupIds),
                or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
              ),
            )
            .groupBy(topics.groupId)
        : [],
      groupIds.length
        ? new ChatGroupModel(this.db, this.userId, this.workspaceId).getMemberAvatarsByGroupIds(
            groupIds,
          )
        : new Map<string, Array<{ avatar: string | null; backgroundColor: string | null }>>(),
    ]);
    const topicByParent = new Map(
      latestTopics.map((topic) => [
        topic.routeGroupId ? `group:${topic.routeGroupId}` : `agent:${topic.routeId}`,
        topic,
      ]),
    );
    const agentUnread = new Map(agentUnreadRows.map((row) => [row.id, row.value]));
    const groupUnread = new Map(groupUnreadRows.map((row) => [row.id, row.value]));

    return {
      items: page.map((parent) => {
        const topic = topicByParent.get(`${parent.kind}:${parent.id}`);
        const meta =
          parent.kind === 'agent'
            ? normalizeInboxAgentMeta(
                { avatar: parent.avatar, title: parent.title },
                { slug: parent.slug },
              )
            : { avatar: parent.avatar, title: parent.title };
        const groupMembers = groupAvatarMap.get(parent.id) ?? [];

        return {
          avatar:
            meta.avatar ??
            (parent.kind === 'group'
              ? groupMembers
                  .filter((member) => member.avatar)
                  .map((member) => ({
                    avatar: member.avatar as string,
                    background: member.backgroundColor ?? undefined,
                  }))
              : undefined),
          backgroundColor: parent.backgroundColor,
          id: parent.id,
          kind: parent.kind,
          pinned: parent.pinned,
          title:
            meta.title?.trim() ||
            (parent.kind === 'group' ? 'Untitled Group' : 'Untitled Assistant'),
          topic,
          unreadCount: (parent.kind === 'group' ? groupUnread : agentUnread).get(parent.id) ?? 0,
          updatedAt: topic?.updatedAt ?? parent.updatedAt,
        };
      }),
      nextCursor: hasMore && page.length ? encodeMobileWorkspaceCursor(page.at(-1)!) : undefined,
    };
  };

  queryLatestTopicsByParents = async ({
    agentIds,
    groupIds,
  }: RecentTopicParentIds): Promise<RecentDbItem[]> => {
    if (agentIds.length === 0 && groupIds.length === 0) return [];

    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    const latestTopicMessageAtSubquery = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), buildWorkspaceWhere(scope, messages)))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`GREATEST(${topics.updatedAt}, COALESCE((${latestTopicMessageAtSubquery}), ${topics.updatedAt}))`.mapWith(
        topics.updatedAt,
      );
    const parentKey = sql<string>`CASE
      WHEN ${topics.groupId} IS NOT NULL THEN 'group:' || ${topics.groupId}
      ELSE 'agent:' || ${topics.agentId}
    END`;
    const agentWhere = and(isNull(topics.groupId), inArray(topics.agentId, agentIds));
    const groupWhere = inArray(topics.groupId, groupIds);
    const parentWhere =
      agentIds.length > 0 && groupIds.length > 0
        ? or(agentWhere, groupWhere)
        : agentIds.length > 0
          ? agentWhere
          : groupWhere;

    const rows = await this.db
      .selectDistinctOn([parentKey], {
        id: topics.id,
        metadata: sql<any>`${topics.metadata}`.as('metadata'),
        routeGroupId: sql<string | null>`${topics.groupId}`.as('route_group_id'),
        routeId: sql<string | null>`${topics.agentId}`.as('route_id'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title: sql<string>`COALESCE(${topics.title}, 'Untitled Topic')`.as('title'),
        type: sql<RecentDbItem['type']>`'topic'`.as('type'),
        updatedAt: topicActivityAt.as('updated_at'),
        userId: topics.userId,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .where(
        and(
          buildWorkspaceWhere(scope, topics),
          parentWhere,
          notShareVisitorTopic(),
          or(
            isNotNull(topics.groupId),
            eq(agents.slug, 'inbox'),
            and(isNull(topics.groupId), ne(agents.virtual, true)),
          ),
          or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
        ),
      )
      .orderBy(parentKey, desc(topicActivityAt), desc(topics.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      metadata: row.metadata ?? undefined,
      routeGroupId: row.routeGroupId,
      routeId: row.routeId,
      status: row.status,
      title: row.title,
      type: row.type,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any),
      userId: row.userId,
    }));
  };
}
