import { describe, expect, it } from 'vitest';

import {
  buildNotificationPreferenceGroups,
  DEFAULT_NOTIFICATION_EVENT_DEFAULTS,
  normalizeNotificationEventDefaults,
} from './notificationPreferences';

describe('notificationPreferences', () => {
  it('keeps the official notification channels and event defaults', () => {
    const groups = buildNotificationPreferenceGroups({
      emailEnabled: true,
      inboxEnabled: true,
      pushEnabled: true,
    });

    expect(groups.map((group) => group.title)).toEqual([
      '邮件通知',
      '站内通知',
      '移动推送通知',
    ]);
    expect(groups[0].events.map((event) => event.title)).toEqual([
      '积分余额即将用尽',
      '图片生成完成',
      '视频生成完成',
      '计划任务失败',
      '新成员加入',
      '续订付款失败',
      '付款方式已移除',
      '主要所有权已转移',
      '订阅已结束',
    ]);
    expect(groups[1].events.map((event) => event.title)).toContain('工作区邀请');
    expect(groups[2].events.map((event) => event.title)).toEqual([
      '图片生成完成',
      '视频生成完成',
    ]);
    expect(DEFAULT_NOTIFICATION_EVENT_DEFAULTS.email.lowCredits).toBe(true);
  });

  it('normalizes event defaults while ignoring unknown channels and events', () => {
    expect(
      normalizeNotificationEventDefaults({
        email: {
          lowCredits: false,
          unknown: false,
        },
        push: {
          imageGenerationCompleted: false,
        },
        sms: {
          lowCredits: false,
        },
      }),
    ).toMatchObject({
      email: {
        lowCredits: false,
        imageGenerationCompleted: true,
      },
      inbox: {
        workspaceInvitation: true,
      },
      push: {
        imageGenerationCompleted: false,
        videoGenerationCompleted: true,
      },
    });
  });
});
