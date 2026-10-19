import type { NotificationSettings } from '@lobechat/types';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  email: {
    enabled: true,
    items: {
      billing: {
        payment_method_removed: true,
        subscription_ended: true,
        subscription_renewal_payment_failed: true,
      },
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
      task: {
        scheduled_task_failed: true,
      },
      usage: {
        low_credits: true,
      },
      workspace: {
        primary_ownership_transferred: true,
        workspace_member_joined: true,
      },
    },
  },
  inbox: {
    enabled: true,
    items: {
      billing: {
        payment_method_removed: true,
        subscription_ended: true,
        subscription_renewal_payment_failed: true,
      },
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
      task: {
        scheduled_task_failed: true,
      },
      workspace: {
        primary_ownership_transferred: true,
        workspace_invitation: true,
        workspace_member_joined: true,
        workspace_member_removed: true,
      },
    },
  },
  push: {
    enabled: true,
    items: {
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
    },
  },
};
