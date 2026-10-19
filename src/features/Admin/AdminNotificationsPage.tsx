'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, InputNumber, message, Switch, Typography } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import {
  normalizeNotificationEventDefaults,
  NOTIFICATION_CHANNEL_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TITLES,
  type NotificationEventDefaults,
} from '@/const/notificationPreferences';
import { SETTING_KEYS, type SettingUpdate } from '@/features/Admin/adminSettingsForm';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

const { Text } = Typography;

type NotificationSettingsForm = {
  desktopEnabled: boolean;
  emailEnabled: boolean;
  eventDefaults: NotificationEventDefaults;
  inboxEnabled: boolean;
  pushEnabled: boolean;
  retentionDays: number;
  systemActionLabel: string;
  systemActionUrl: string;
  systemContent: string;
  systemEnabled: boolean;
  systemTitle: string;
  systemType: 'error' | 'info' | 'success' | 'warning';
};

export const buildInitialValues = (data: any): NotificationSettingsForm => ({
  desktopEnabled: data?.notificationDesktopEnabled ?? true,
  emailEnabled: data?.notificationEmailEnabled ?? false,
  eventDefaults: normalizeNotificationEventDefaults(data?.notificationEventDefaults),
  inboxEnabled: data?.notificationInboxEnabled ?? true,
  pushEnabled: data?.notificationPushEnabled ?? data?.notificationDesktopEnabled ?? true,
  retentionDays: data?.notificationRetentionDays ?? 90,
  systemActionLabel: data?.notificationSystemActionLabel ?? '',
  systemActionUrl: data?.notificationSystemActionUrl ?? '',
  systemContent: data?.notificationSystemContent ?? '',
  systemEnabled: data?.notificationSystemEnabled ?? false,
  systemTitle: data?.notificationSystemTitle ?? '',
  systemType: ['error', 'info', 'success', 'warning'].includes(data?.notificationSystemType)
    ? data.notificationSystemType
    : 'warning',
});

const NOTIFICATION_SETTING_MAP: Array<[keyof NotificationSettingsForm, string]> = [
  ['inboxEnabled', SETTING_KEYS.notificationInboxEnabled],
  ['desktopEnabled', SETTING_KEYS.notificationDesktopEnabled],
  ['emailEnabled', SETTING_KEYS.notificationEmailEnabled],
  ['pushEnabled', SETTING_KEYS.notificationPushEnabled],
  ['retentionDays', SETTING_KEYS.notificationRetentionDays],
  ['systemEnabled', SETTING_KEYS.notificationSystemEnabled],
  ['systemTitle', SETTING_KEYS.notificationSystemTitle],
  ['systemContent', SETTING_KEYS.notificationSystemContent],
  ['systemActionLabel', SETTING_KEYS.notificationSystemActionLabel],
  ['systemActionUrl', SETTING_KEYS.notificationSystemActionUrl],
  ['systemType', SETTING_KEYS.notificationSystemType],
];

const buildUpdates = (
  values: NotificationSettingsForm,
  initial: NotificationSettingsForm,
): SettingUpdate[] => {
  const updates = NOTIFICATION_SETTING_MAP.filter(([key]) => values[key] !== initial[key]).map(
    ([key, settingKey]) => ({ key: settingKey, value: values[key] }),
  );

  const normalizedCurrent = normalizeNotificationEventDefaults(values.eventDefaults);
  const normalizedInitial = normalizeNotificationEventDefaults(initial.eventDefaults);
  if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedInitial)) {
    updates.push({ key: SETTING_KEYS.notificationEventDefaults, value: normalizedCurrent });
  }

  return updates;
};

export const buildNotificationMaterializationUpdates = (
  values: NotificationSettingsForm,
): SettingUpdate[] => [
  ...NOTIFICATION_SETTING_MAP.map(([key, settingKey]) => ({ key: settingKey, value: values[key] })),
  {
    key: SETTING_KEYS.notificationEventDefaults,
    value: normalizeNotificationEventDefaults(values.eventDefaults),
  },
];

const AdminNotificationsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('notifications'), () =>
    adminCommercialService.getSettingsSection('notifications'),
  );
  const [form] = Form.useForm<NotificationSettingsForm>();
  const [materializing, setMaterializing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initialValues = useMemo(() => buildInitialValues(data), [data]);

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue(buildInitialValues(data));
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    const values = await form.validateFields();
    const updates = buildUpdates(values, initialValues);

    if (updates.length === 0) {
      message.info(t('admin.notifications.noChanges', '没有需要保存的变更'));
      return;
    }

    setSubmitting(true);
    try {
      await adminCommercialService.setAppSettingsBatch({ updates });
      await mutate('public-notification-config');
      message.success(t('admin.notifications.saveSuccess', '通知配置已保存'));
    } catch {
      message.error(t('admin.notifications.saveFailed', '保存通知配置失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMaterializeDefaults = async () => {
    if (!data) return;

    const values = await form.validateFields();
    const updates = buildNotificationMaterializationUpdates(values);

    setMaterializing(true);
    try {
      await adminCommercialService.setAppSettingsBatch({ updates });
      await mutate('public-notification-config');
      message.success(t('admin.notifications.materializeDefaultsSuccess', '通知默认值已同步'));
    } catch {
      message.error(t('admin.notifications.materializeDefaultsFailed', '同步通知默认值失败'));
    } finally {
      setMaterializing(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.notifications.title', '公告与通知')}
      width="medium"
      description={t(
        'admin.notifications.subtitle',
        '统一管理站内、邮件和推送默认策略，以及系统公告与通知保留时间。',
      )}
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.notifications.analysis',
          '邮件和推送开关是默认投递策略，只有对应投递渠道已配置时才会实际发送。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.notifications.loadFailed', '无法读取当前通知配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}

      <Form disabled={isLoading} form={form} initialValues={initialValues} layout="vertical">
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.notifications.channels', '通知渠道')}
            description={t(
              'admin.notifications.channelsDescription',
              '为每个投递渠道设置默认启用状态和事件范围。',
            )}
          >
            <AdminFormGrid columns={3} label={t('admin.notifications.channels', '通知渠道')}>
              {NOTIFICATION_CHANNELS.map((channel) => {
                const enabledField =
                  channel.key === 'email'
                    ? 'emailEnabled'
                    : channel.key === 'inbox'
                      ? 'inboxEnabled'
                      : 'pushEnabled';

                return (
                  <Card key={channel.key} title={channel.title}>
                    <Form.Item
                      extra={channel.description}
                      name={enabledField}
                      valuePropName="checked"
                      label={t(
                        `admin.notifications.${channel.key}.enabled`,
                        `启用${channel.title}`,
                      )}
                    >
                      <Switch />
                    </Form.Item>
                    <Flexbox gap={8}>
                      <Text strong>{t('admin.notifications.events', '默认事件开关')}</Text>
                      {NOTIFICATION_CHANNEL_EVENTS[channel.key].map((eventKey) => (
                        <Flexbox
                          horizontal
                          align="center"
                          justify="space-between"
                          key={`${channel.key}-${eventKey}`}
                        >
                          <Text>{NOTIFICATION_EVENT_TITLES[eventKey]}</Text>
                          <Form.Item
                            noStyle
                            name={['eventDefaults', channel.key, eventKey]}
                            valuePropName="checked"
                          >
                            <Switch
                              aria-label={`${channel.title}: ${NOTIFICATION_EVENT_TITLES[eventKey]}`}
                            />
                          </Form.Item>
                        </Flexbox>
                      ))}
                    </Flexbox>
                  </Card>
                );
              })}
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.notifications.compatibility', '兼容与保留策略')}
            description={t(
              'admin.notifications.compatibilityDescription',
              '保留旧桌面端读取兼容项，并设置归档通知的清理周期。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.notifications.desktopEnabled', '旧桌面通知默认值')}
                name="desktopEnabled"
                valuePropName="checked"
                extra={t(
                  'admin.notifications.desktopEnabled.help',
                  '仅供旧桌面端通知读取器使用；新版本由移动推送渠道控制。',
                )}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.notifications.retentionDays', '归档通知保留天数')}
                name="retentionDays"
                extra={t(
                  'admin.notifications.retentionDays.help',
                  '维护任务会删除超过该天数的已归档通知。',
                )}
              >
                <InputNumber max={3650} min={1} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.notifications.system', '系统公告')}
            description={t(
              'admin.notifications.systemDescription',
              '配置向所有用户展示的系统级公告及可选操作入口。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.notifications.systemEnabled', '启用系统公告')}
                name="systemEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t('admin.notifications.systemType', '公告类型')} name="systemType">
                <Select
                  disabled={isLoading}
                  options={[
                    { label: '信息', value: 'info' },
                    { label: '成功', value: 'success' },
                    { label: '警告', value: 'warning' },
                    { label: '错误', value: 'error' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.notifications.systemTitle', '公告标题')}
                name="systemTitle"
              >
                <Input placeholder="服务升级通知" />
              </Form.Item>
              <Form.Item
                label={t('admin.notifications.systemActionLabel', '操作按钮名称')}
                name="systemActionLabel"
              >
                <Input placeholder="查看详情" />
              </Form.Item>
              <Form.Item
                label={t('admin.notifications.systemActionUrl', '操作跳转地址')}
                name="systemActionUrl"
              >
                <Input placeholder="https://..." />
              </Form.Item>
            </AdminFormGrid>
            <Form.Item
              label={t('admin.notifications.systemContent', '公告内容')}
              name="systemContent"
            >
              <Input.TextArea autoSize={{ minRows: 3 }} placeholder="向用户展示的公告内容" />
            </Form.Item>
          </AdminSection>

          <AdminFormActions label={t('admin.notifications.actions', '通知配置操作')}>
            <Button
              disabled={isLoading || !data || submitting}
              loading={materializing}
              onClick={handleMaterializeDefaults}
            >
              {t('admin.notifications.materializeDefaults', '同步默认值')}
            </Button>
            <Button
              disabled={isLoading || !data || materializing}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              {t('admin.notifications.save', '保存通知配置')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

AdminNotificationsPage.displayName = 'AdminNotificationsPage';

export default AdminNotificationsPage;
