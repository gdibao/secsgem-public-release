export type NotificationChannelKey = 'email' | 'inbox' | 'push';

export type NotificationEventKey =
  | 'lowCredits'
  | 'imageGenerationCompleted'
  | 'videoGenerationCompleted'
  | 'scheduledTaskFailed'
  | 'workspaceInvitation'
  | 'newMemberJoined'
  | 'workspaceMemberRemoved'
  | 'subscriptionRenewalPaymentFailed'
  | 'paymentMethodRemoved'
  | 'primaryOwnershipTransferred'
  | 'subscriptionEnded';

export type NotificationEventDefaults = Record<
  NotificationChannelKey,
  Partial<Record<NotificationEventKey, boolean>>
>;

export type NotificationPreferenceGroup = {
  description: string;
  enabled: boolean;
  events: Array<{
    enabled: boolean;
    key: NotificationEventKey;
    title: string;
  }>;
  key: NotificationChannelKey;
  title: string;
};

export const NOTIFICATION_CHANNELS: Array<{
  description: string;
  key: NotificationChannelKey;
  title: string;
}> = [
  {
    description: '接收积分、生成任务、团队和订阅相关邮件提醒。',
    key: 'email',
    title: '邮件通知',
  },
  {
    description: '在站内通知中心接收任务、团队和订阅提醒。',
    key: 'inbox',
    title: '站内通知',
  },
  {
    description: '在移动端或桌面端接收生成任务完成推送。',
    key: 'push',
    title: '移动推送通知',
  },
];

export const NOTIFICATION_EVENT_TITLES: Record<NotificationEventKey, string> = {
  imageGenerationCompleted: '图片生成完成',
  lowCredits: '积分余额即将用尽',
  newMemberJoined: '新成员加入',
  paymentMethodRemoved: '付款方式已移除',
  primaryOwnershipTransferred: '主要所有权已转移',
  scheduledTaskFailed: '计划任务失败',
  subscriptionEnded: '订阅已结束',
  subscriptionRenewalPaymentFailed: '续订付款失败',
  videoGenerationCompleted: '视频生成完成',
  workspaceInvitation: '工作区邀请',
  workspaceMemberRemoved: '已从工作区移除',
};

export const NOTIFICATION_CHANNEL_EVENTS: Record<NotificationChannelKey, NotificationEventKey[]> = {
  email: [
    'lowCredits',
    'imageGenerationCompleted',
    'videoGenerationCompleted',
    'scheduledTaskFailed',
    'newMemberJoined',
    'subscriptionRenewalPaymentFailed',
    'paymentMethodRemoved',
    'primaryOwnershipTransferred',
    'subscriptionEnded',
  ],
  inbox: [
    'imageGenerationCompleted',
    'videoGenerationCompleted',
    'scheduledTaskFailed',
    'workspaceInvitation',
    'newMemberJoined',
    'workspaceMemberRemoved',
    'subscriptionRenewalPaymentFailed',
    'paymentMethodRemoved',
    'primaryOwnershipTransferred',
    'subscriptionEnded',
  ],
  push: ['imageGenerationCompleted', 'videoGenerationCompleted'],
};

export const DEFAULT_NOTIFICATION_EVENT_DEFAULTS: NotificationEventDefaults = {
  email: Object.fromEntries(NOTIFICATION_CHANNEL_EVENTS.email.map((key) => [key, true])),
  inbox: Object.fromEntries(NOTIFICATION_CHANNEL_EVENTS.inbox.map((key) => [key, true])),
  push: Object.fromEntries(NOTIFICATION_CHANNEL_EVENTS.push.map((key) => [key, true])),
} as NotificationEventDefaults;

export const normalizeNotificationEventDefaults = (
  value: unknown,
): NotificationEventDefaults => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return Object.fromEntries(
    NOTIFICATION_CHANNELS.map((channel) => {
      const channelValue = (source as Record<string, unknown>)[channel.key];
      const channelSource =
        channelValue && typeof channelValue === 'object' && !Array.isArray(channelValue)
          ? (channelValue as Record<string, unknown>)
          : {};

      return [
        channel.key,
        Object.fromEntries(
          NOTIFICATION_CHANNEL_EVENTS[channel.key].map((eventKey) => [
            eventKey,
            typeof channelSource[eventKey] === 'boolean'
              ? channelSource[eventKey]
              : DEFAULT_NOTIFICATION_EVENT_DEFAULTS[channel.key][eventKey] !== false,
          ]),
        ),
      ];
    }),
  ) as NotificationEventDefaults;
};

export const buildNotificationPreferenceGroups = (config?: {
  desktopEnabled?: boolean | null;
  emailEnabled?: boolean | null;
  eventDefaults?: unknown;
  inboxEnabled?: boolean | null;
  pushEnabled?: boolean | null;
}): NotificationPreferenceGroup[] => {
  const eventDefaults = normalizeNotificationEventDefaults(config?.eventDefaults);
  const enabledByChannel: Record<NotificationChannelKey, boolean> = {
    email: config?.emailEnabled === true,
    inbox: config?.inboxEnabled !== false,
    push: config?.pushEnabled ?? config?.desktopEnabled ?? true,
  };

  return NOTIFICATION_CHANNELS.map((channel) => ({
    ...channel,
    enabled: enabledByChannel[channel.key],
    events: NOTIFICATION_CHANNEL_EVENTS[channel.key].map((eventKey) => ({
      enabled: eventDefaults[channel.key][eventKey] !== false,
      key: eventKey,
      title: NOTIFICATION_EVENT_TITLES[eventKey],
    })),
  }));
};
