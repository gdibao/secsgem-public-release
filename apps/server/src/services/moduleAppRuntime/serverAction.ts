import { z } from 'zod';

import type { ModuleAppRunnerResult } from '@/business/server/module-apps/runModuleAppAction';
import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';

const NotificationInputSchema = z.object({
  actionUrl: z.string().startsWith('/').max(500).optional(),
  content: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(120),
});

export const createModuleAppServerAction = (params: { db: LobeChatDatabase }) =>
  async (input: {
    actionKey: string;
    idempotencyKey: string;
    input: Record<string, unknown>;
    installationId: string;
    userId: string;
  }): Promise<ModuleAppRunnerResult> => {
    if (input.actionKey !== 'notifications.create') {
      throw new Error('MODULE_APP_SERVER_ACTION_DENIED');
    }

    const notification = NotificationInputSchema.parse(input.input);
    if (notification.actionUrl?.startsWith('//')) {
      throw new Error('MODULE_APP_NOTIFICATION_ACTION_DENIED');
    }
    const created = await new NotificationModel(params.db, input.userId).create({
      actionUrl: notification.actionUrl,
      category: 'module_app',
      content: notification.content,
      dedupeKey: `${input.installationId}:${input.idempotencyKey}`,
      title: notification.title,
      type: 'module_app_event',
    });

    return {
      output: { notificationId: created?.id ?? null },
      preview: notification.title,
    };
  };
