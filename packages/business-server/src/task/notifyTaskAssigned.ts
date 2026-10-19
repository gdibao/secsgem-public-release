import { and, eq } from 'drizzle-orm';

import { NotificationModel } from '@/database/models/notification';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { taskActivities } from '@/database/schemas/task';
import type { LobeChatDatabase } from '@/database/type';

export interface NotifyTaskAssignedParams {
  /** The member who performed the assignment — never notified. */
  actorUserId: string;
  /** The member the task was assigned to — the notification recipient. */
  assigneeUserId: string;
  eventId: string;
  taskId: string;
  workspaceId?: string;
}

type LegacyNotifyTaskAssignedParams = Omit<NotifyTaskAssignedParams, 'eventId'> & {
  taskIdentifier: string;
  taskName?: string | null;
};

export function notifyTaskAssigned(params: LegacyNotifyTaskAssignedParams): Promise<void>;
export function notifyTaskAssigned(
  db: LobeChatDatabase,
  params: NotifyTaskAssignedParams,
): Promise<void>;
export async function notifyTaskAssigned(
  databaseOrLegacy: LobeChatDatabase | LegacyNotifyTaskAssignedParams,
  params?: NotifyTaskAssignedParams,
): Promise<void> {
  // TaskService persists the receipt; legacy post-response hooks have no event to replay.
  if (!params) return;
  const db = databaseOrLegacy as LobeChatDatabase;
  const { actorUserId, assigneeUserId, eventId, taskId, workspaceId } = params;
  if (!workspaceId || !assigneeUserId || assigneeUserId === actorUserId) return;

  // Also supports replay of a committed event. Nested transactions remain inside
  // the caller's task mutation; a delivery error must never commit a partial receipt.
  await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(taskActivities)
      .where(and(
        eq(taskActivities.id, eventId),
        eq(taskActivities.taskId, taskId),
        eq(taskActivities.workspaceId, workspaceId),
      ))
      .limit(1);
    if (
      !event || event.id !== eventId || event.taskId !== taskId ||
      event.workspaceId !== workspaceId || event.userId !== actorUserId ||
      event.type !== 'assignee_user' || event.payload?.toId !== assigneeUserId ||
      event.payload.fromId === assigneeUserId
    ) return;

    const member = await new WorkspaceMemberModel(tx, assigneeUserId).getMember(
      workspaceId, assigneeUserId,
    );
    if (!member || member.deletedAt || !['owner', 'admin', 'member', 'viewer'].includes(member.role)) {
      return;
    }
    const task = await new TaskModel(tx, assigneeUserId, workspaceId).findById(taskId);
    if (!task || task.workspaceId !== workspaceId || task.assigneeUserId !== assigneeUserId) return;
    if (
      task.projectId &&
      !(await new ProjectModel(tx, assigneeUserId, workspaceId).findById(task.projectId))
    ) return;

    const model = new NotificationModel(tx, assigneeUserId, { workspaceId });
    const notification = await model.create({
      actionUrl: `/task/${encodeURIComponent(task.id)}`,
      category: 'task',
      content: task.name || task.identifier,
      dedupeKey: `task-assignment:${workspaceId}:${event.id}`,
      metadata: { taskAssignment: { eventId: event.id, taskId: task.id } },
      title: 'New task assignment',
      type: 'task_assignment',
      workspaceId,
    });
    if (!notification) return;
    await model.createDelivery({
      channel: 'inbox',
      notificationId: notification.id,
      sentAt: new Date(),
      status: 'delivered',
    });
  });
}
