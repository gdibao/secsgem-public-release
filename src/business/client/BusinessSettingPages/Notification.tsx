'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Switch, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import { buildNotificationPreferenceGroups } from '@/const/notificationPreferences';
import { useClientDataSWR } from '@/libs/swr';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { adminCommercialService } from '@/services/adminCommercial';

import { SubscriptionIframeWrapper } from './SubscriptionIframeWrapper';

const { Text } = Typography;

type SystemAlertType = 'error' | 'info' | 'success' | 'warning';

const normalizeSystemAlertType = (type?: null | string): SystemAlertType =>
  type === 'error' || type === 'info' || type === 'success' || type === 'warning'
    ? type
    : 'warning';

const WebNotification = memo(() => {
  const { t } = useTranslation('setting');
  const { data } = useClientDataSWR('public-notification-config', () =>
    adminCommercialService.getPublicNotificationConfig(),
  );

  const groups = buildNotificationPreferenceGroups(data);

  return (
    <>
      <SettingHeader title={t('tab.notification')} />
      <Flexbox gap={16} padding={24}>
        <Alert
          showIcon
          type="info"
          message={t(
            'notification.adminManaged',
            '通知偏好由管理员统一配置；当前页面用于查看各通道默认策略和站内公告。',
          )}
        />
        {data?.system?.enabled && (data.system.title || data.system.content) ? (
          <Alert
            showIcon
            description={data.system.content}
            message={data.system.title || t('notification.system.title', '系统公告')}
            type={normalizeSystemAlertType(data.system.type)}
            action={
              data.system.actionUrl ? (
                <Button href={data.system.actionUrl} rel="noreferrer" size="small" target="_blank">
                  {data.system.actionLabel || t('notification.system.action', '查看详情')}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {groups.map((group) => (
          <Card
            key={group.key}
            title={
              <Flexbox horizontal align="center" justify="space-between">
                <Flexbox gap={2}>
                  <Text strong>{group.title}</Text>
                  <Text type="secondary">{group.description}</Text>
                </Flexbox>
                <Switch aria-label={group.title} checked={group.enabled} disabled />
              </Flexbox>
            }
          >
            <Flexbox gap={12}>
              {group.events.map((event) => (
                <Flexbox
                  horizontal
                  align="center"
                  justify="space-between"
                  key={`${group.key}-${event.key}`}
                >
                  <Text>{event.title}</Text>
                  <Switch
                    aria-label={`${group.title}：${event.title}`}
                    checked={group.enabled && event.enabled}
                    disabled
                  />
                </Flexbox>
              ))}
            </Flexbox>
          </Card>
        ))}
      </Flexbox>
    </>
  );
});

WebNotification.displayName = 'WebNotification';

const Notification = memo(() => {
  if (isDesktop) return <SubscriptionIframeWrapper page="notification" />;

  return <WebNotification />;
});

Notification.displayName = 'Notification';

export default Notification;
