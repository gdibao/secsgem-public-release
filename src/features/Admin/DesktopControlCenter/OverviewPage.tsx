'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert, Result, Skeleton, Tag, Typography } from 'antd';
import { RefreshCw, Settings2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { desktopControlCenterStyles } from './styles';
import {
  DESKTOP_CHANNEL_LABEL_KEYS,
  DESKTOP_PLATFORM_LABEL_KEYS,
  DESKTOP_REASON_LABEL_KEYS,
  type DesktopChannel,
  type DesktopOverviewResource,
} from './types';

const statusColor = (status: 'degraded' | 'healthy' | 'unavailable') => {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'error';
};

interface OverviewPageProps {
  onConfigure: () => void;
  resource: DesktopOverviewResource;
}

const OverviewPage = memo<OverviewPageProps>(({ onConfigure, resource }) => {
  const { t } = useTranslation('subscription');

  if (resource.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;

  if (resource.error) {
    return (
      <Result
        status="error"
        title={t('admin.desktopControl.error.title')}
        extra={
          <Button icon={<Icon icon={RefreshCw} size={16} />} onClick={() => void resource.mutate()}>
            {t('admin.desktopControl.retry')}
          </Button>
        }
      />
    );
  }

  const data = resource.data;
  if (!data) return null;

  const statusItems = [
    {
      label: t('admin.desktopControl.status.configuredVersion'),
      value: data.configuredVersion || '-',
    },
    {
      label: t('admin.desktopControl.status.stable'),
      value: data.diagnostics.channels.find(({ channel }) => channel === 'stable')?.version || '-',
    },
    {
      label: t('admin.desktopControl.status.canary'),
      value: data.diagnostics.channels.find(({ channel }) => channel === 'canary')?.version || '-',
    },
    {
      label: t('admin.desktopControl.status.checkedAt'),
      value: new Date(data.diagnostics.checkedAt).toLocaleString(),
    },
  ];

  return (
    <Flexbox gap={24}>
      {!data.diagnostics.configured ? (
        <Alert
          showIcon
          description={t('admin.desktopControl.unconfigured.description')}
          message={t('admin.desktopControl.unconfigured.title')}
          type="warning"
          action={
            <Button icon={<Icon icon={Settings2} size={16} />} onClick={onConfigure}>
              {t('admin.desktopControl.configure')}
            </Button>
          }
        />
      ) : null}

      <div className={desktopControlCenterStyles.statusBand}>
        {statusItems.map((item) => (
          <div className={desktopControlCenterStyles.statusItem} key={item.label}>
            <Typography.Text className={desktopControlCenterStyles.statusLabel}>
              {item.label}
            </Typography.Text>
            <Typography.Text ellipsis strong>
              {item.value}
            </Typography.Text>
          </div>
        ))}
      </div>

      <section className={desktopControlCenterStyles.channelSection}>
        <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
          {t('admin.desktopControl.policy.title')}
        </Typography.Title>
        <div className={desktopControlCenterStyles.statusBand}>
          <div className={desktopControlCenterStyles.statusItem}>
            <Typography.Text className={desktopControlCenterStyles.statusLabel}>
              {t('admin.desktopControl.policy.autoCheck')}
            </Typography.Text>
            <Tag color={data.runtimePolicy.autoCheck ? 'success' : 'default'}>
              {t(
                data.runtimePolicy.autoCheck
                  ? 'admin.desktopControl.policy.enabled'
                  : 'admin.desktopControl.policy.disabled',
              )}
            </Tag>
          </div>
          <div className={desktopControlCenterStyles.statusItem}>
            <Typography.Text className={desktopControlCenterStyles.statusLabel}>
              {t('admin.desktopControl.policy.defaultChannel')}
            </Typography.Text>
            <Typography.Text strong>
              {t(DESKTOP_CHANNEL_LABEL_KEYS[data.runtimePolicy.channel as DesktopChannel])}
            </Typography.Text>
          </div>
          <div className={desktopControlCenterStyles.statusItem}>
            <Typography.Text className={desktopControlCenterStyles.statusLabel}>
              {t('admin.desktopControl.policy.checkInterval')}
            </Typography.Text>
            <Typography.Text strong>
              {data.runtimePolicy.checkInterval} {t('admin.desktopControl.policy.minutes')}
            </Typography.Text>
          </div>
        </div>
      </section>

      <section className={desktopControlCenterStyles.channelSection}>
        <Flexbox horizontal align="center" justify="space-between">
          <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
            {t('admin.desktopControl.automation.title')}
          </Typography.Title>
          <Tag color={data.automation.configured ? 'success' : 'warning'}>
            {t(
              data.automation.configured
                ? 'admin.desktopControl.automation.configured'
                : 'admin.desktopControl.automation.unconfigured',
            )}
          </Tag>
        </Flexbox>
        {!data.automation.configured ? (
          <Alert
            showIcon
            message={t('admin.desktopControl.automation.unconfiguredDescription')}
            type="warning"
          />
        ) : null}
        <div className={desktopControlCenterStyles.statusBand}>
          {[
            {
              label: t('admin.desktopControl.automation.repository'),
              value: data.automation.repository || '-',
            },
            {
              label: t('admin.desktopControl.automation.ref'),
              value: data.automation.ref || '-',
            },
            {
              label: t('admin.desktopControl.automation.workflow'),
              value: data.automation.workflowFile,
            },
            {
              label: t('admin.desktopControl.automation.token'),
              value: t(
                data.automation.tokenConfigured
                  ? 'admin.desktopControl.automation.tokenConfigured'
                  : 'admin.desktopControl.automation.tokenMissing',
              ),
            },
          ].map((item) => (
            <div className={desktopControlCenterStyles.statusItem} key={item.label}>
              <Typography.Text className={desktopControlCenterStyles.statusLabel}>
                {item.label}
              </Typography.Text>
              <Typography.Text ellipsis strong>
                {item.value}
              </Typography.Text>
            </div>
          ))}
        </div>
      </section>

      {data.diagnostics.channels.map((channel) => (
        <section className={desktopControlCenterStyles.channelSection} key={channel.channel}>
          <Flexbox horizontal align="center" justify="space-between">
            <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
              {t(DESKTOP_CHANNEL_LABEL_KEYS[channel.channel])}
            </Typography.Title>
            <Tag color={statusColor(channel.status)}>
              {t(`admin.desktopControl.channel.${channel.status}`)}
            </Tag>
          </Flexbox>
          {channel.status === 'unavailable' &&
          Object.values(channel.platforms).some(({ reason }) => reason) ? (
            <Alert
              showIcon
              type="warning"
              message={t(
                DESKTOP_REASON_LABEL_KEYS[
                  Object.values(channel.platforms).find(({ reason }) => reason)?.reason ||
                    'manifest-request-failed'
                ],
              )}
            />
          ) : null}
          <div className={desktopControlCenterStyles.channelGrid}>
            {Object.entries(channel.platforms).map(([type, artifact]) => (
              <div className={desktopControlCenterStyles.platformSummary} key={type}>
                <Typography.Text strong>
                  {t(DESKTOP_PLATFORM_LABEL_KEYS[type as keyof typeof DESKTOP_PLATFORM_LABEL_KEYS])}
                </Typography.Text>
                <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                  {artifact.assetName ||
                    (artifact.reason ? t(DESKTOP_REASON_LABEL_KEYS[artifact.reason]) : '-')}
                </Typography.Paragraph>
                <Tag color={artifact.status === 'available' ? 'success' : 'default'}>
                  {t(`admin.desktopControl.artifact.${artifact.status}`)}
                </Tag>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Flexbox>
  );
});

OverviewPage.displayName = 'OverviewPage';

export default OverviewPage;
