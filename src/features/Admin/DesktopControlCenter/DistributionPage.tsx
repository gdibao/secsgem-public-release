'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import {
  Alert,
  Descriptions,
  Empty,
  Form,
  Input,
  message,
  Result,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ExternalLink, RefreshCw, Save } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeDesktopDownloadUrl } from '@/const/desktopUpdate';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminSettingsConflictAlert from '../shared/AdminSettingsConflictAlert';
import {
  buildDistributionUpdates,
  type DesktopSettingsValues,
  getDesktopSettingsValues,
  isDesktopFormValidationError,
} from './desktopSettingsForm';
import { desktopControlCenterStyles } from './styles';
import {
  DESKTOP_CHANNEL_LABEL_KEYS,
  DESKTOP_PLATFORM_LABEL_KEYS,
  DESKTOP_REASON_LABEL_KEYS,
  type DesktopChannel,
  type DesktopDiagnosticReason,
  type DesktopOverviewResource,
  type DesktopPlatform,
  type DesktopSettingsResource,
} from './types';
import { useDesktopSettingsFormSync } from './useDesktopSettingsFormSync';

type DistributionRow = {
  asset?: string;
  channel: DesktopChannel;
  key: string;
  platform: DesktopPlatform;
  publishedAt?: string;
  reason?: DesktopDiagnosticReason;
  sha512?: string;
  size?: number;
  status: 'available' | 'missing' | 'unavailable';
  url?: string;
  version?: string;
};

const formatSize = (size?: number) => {
  if (!size || size < 1) return '-';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

const isAllowedDownloadUrl = (value?: string) => 'url' in normalizeDesktopDownloadUrl(value);

const getRows = (resource: DesktopOverviewResource): DistributionRow[] =>
  resource.data?.diagnostics.channels.flatMap((channel) =>
    Object.entries(channel.platforms).map(([type, artifact]) => ({
      asset: artifact.assetName,
      channel: channel.channel,
      key: `${channel.channel}:${type}`,
      platform: type as DesktopPlatform,
      publishedAt: artifact.publishedAt,
      reason: artifact.reason,
      sha512: artifact.sha512,
      size: artifact.size,
      status: artifact.status,
      url: artifact.url,
      version: artifact.version,
    })),
  ) || [];

interface DistributionPageProps {
  onDirtyChange?: (dirty: boolean) => void;
  overview: DesktopOverviewResource;
  settings: DesktopSettingsResource;
}

const DistributionPage = memo<DistributionPageProps>(({ onDirtyChange, overview, settings }) => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<DesktopSettingsValues>();
  const [saveError, setSaveError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);
  const initialValues = useMemo(() => getDesktopSettingsValues(settings.data), [settings.data]);
  const { dirtyFields, markEdited, markSaved } = useDesktopSettingsFormSync(
    form,
    Boolean(settings.data),
    initialValues,
    onDirtyChange,
  );

  const columns: TableColumnsType<DistributionRow> = [
    {
      dataIndex: 'channel',
      render: (channel: DesktopChannel) => t(DESKTOP_CHANNEL_LABEL_KEYS[channel]),
      title: t('admin.desktopControl.status.channel'),
    },
    {
      dataIndex: 'platform',
      render: (platform: DesktopPlatform) => t(DESKTOP_PLATFORM_LABEL_KEYS[platform]),
      title: t('admin.desktopControl.platform'),
    },
    { dataIndex: 'version', title: t('admin.desktopControl.status.version') },
    {
      dataIndex: 'asset',
      ellipsis: true,
      title: t('admin.desktopControl.asset'),
    },
    {
      dataIndex: 'size',
      render: (size: number | undefined) => formatSize(size),
      title: t('admin.desktopControl.size'),
    },
    {
      dataIndex: 'publishedAt',
      render: (value: string | undefined) => formatDate(value),
      title: t('admin.desktopControl.publishedAt'),
    },
    {
      dataIndex: 'status',
      render: (status: DistributionRow['status']) => (
        <Tag
          color={status === 'available' ? 'success' : status === 'missing' ? 'warning' : 'error'}
        >
          {t(`admin.desktopControl.artifact.${status}`)}
        </Tag>
      ),
      title: t('admin.desktopControl.status.label'),
    },
    {
      key: 'action',
      render: (_value, row) =>
        row.url ? (
          <Tooltip title={t('admin.desktopControl.download')}>
            <Button
              aria-label={`${t('admin.desktopControl.download')}: ${row.asset || row.platform}`}
              href={row.url}
              icon={<Icon icon={ExternalLink} size={16} />}
              rel="noreferrer"
              target="_blank"
              type="text"
            />
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">
            {row.reason ? t(DESKTOP_REASON_LABEL_KEYS[row.reason]) : '-'}
          </Typography.Text>
        ),
      title: '',
    },
  ];

  const diagnosticsContent = overview.isLoading ? (
    <Skeleton active paragraph={{ rows: 6 }} />
  ) : overview.error ? (
    <Result
      status="error"
      title={t('admin.desktopControl.error.title')}
      extra={
        <Button icon={<Icon icon={RefreshCw} size={16} />} onClick={() => void overview.mutate()}>
          {t('admin.desktopControl.retry')}
        </Button>
      }
    />
  ) : !overview.data?.diagnostics.configured ? (
    <Empty
      description={t('admin.desktopControl.unconfigured.title')}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : (
    <div className={desktopControlCenterStyles.tableWrapper}>
      <Table<DistributionRow>
        columns={columns}
        dataSource={getRows(overview)}
        pagination={false}
        rowKey="key"
        scroll={{ x: 900 }}
        size="small"
      />
    </div>
  );

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const updates = buildDistributionUpdates(initialValues, values, dirtyFields);
      if (updates.length === 0) {
        message.info(t('admin.desktopUpdate.noChanges'));
        return;
      }
      setSubmitting(true);
      setSaveError(undefined);
      await adminCommercialService.setAppSettingsBatch({ updates });
      markSaved();
      message.success(t('admin.desktopUpdate.saveSuccess'));
    } catch (error) {
      if (!isDesktopFormValidationError(error)) {
        setSaveError(error);
        if (!(error instanceof Error && error.message === 'APP_SETTINGS_REVISION_CONFLICT')) {
          message.error(t('admin.desktopUpdate.saveFailed'));
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flexbox gap={24}>
      <section className={desktopControlCenterStyles.channelSection}>
        <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
          {t('admin.desktopControl.tabs.distribution')}
        </Typography.Title>
        {diagnosticsContent}
      </section>

      <section className={desktopControlCenterStyles.formSection}>
        <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
          {t('admin.desktopControl.downloadSettings')}
        </Typography.Title>
        <AdminSettingsConflictAlert
          error={saveError}
          onReload={async () => {
            await settings.mutate();
            setSaveError(undefined);
          }}
        />
        {settings.error ? (
          <Alert
            message={t('admin.desktopControl.settingsError')}
            type="error"
            action={
              <Button size="small" onClick={() => void settings.mutate()}>
                {t('admin.desktopControl.retry')}
              </Button>
            }
          />
        ) : settings.isLoading && !settings.data ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <Form
            disabled={settings.isLoading || submitting}
            form={form}
            initialValues={initialValues}
            layout="vertical"
            onValuesChange={markEdited}
          >
            <Form.Item
              label={t('admin.desktopUpdate.downloadUrl')}
              name="downloadUrl"
              rules={[
                {
                  validator: (_rule, value: string | undefined) =>
                    isAllowedDownloadUrl(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('admin.desktopControl.downloadUrlInvalid'))),
                },
              ]}
            >
              <Input placeholder="https://downloads.example.com" />
            </Form.Item>
            <Form.Item label={t('admin.desktopUpdate.downloadLabel')} name="downloadLabel">
              <Input placeholder={t('admin.desktopControl.downloadLabelPlaceholder')} />
            </Form.Item>
            <Alert
              showIcon
              description={t('admin.desktopControl.managedByCi.description')}
              message={t('admin.desktopControl.managedByCi')}
              type="info"
            />
            <Descriptions bordered column={1} size="small" style={{ marginTop: 16 }}>
              <Descriptions.Item label={t('admin.desktopControl.oss.bucket')}>
                {initialValues.ossBucket || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.desktopControl.oss.endpoint')}>
                {initialValues.ossEndpoint || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.desktopControl.oss.credentials')}>
                <Tag color={initialValues.ossCredentialsConfigured ? 'success' : 'default'}>
                  {t(
                    initialValues.ossCredentialsConfigured
                      ? 'admin.desktopControl.oss.configured'
                      : 'admin.desktopControl.oss.notConfigured',
                  )}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.desktopControl.oss.path')}>
                {initialValues.ossPath || '-'}
              </Descriptions.Item>
            </Descriptions>
            <div className={desktopControlCenterStyles.formActions}>
              <Button
                icon={<Icon icon={Save} size={16} />}
                loading={submitting}
                type="primary"
                onClick={() => void handleSave()}
              >
                {t('admin.desktopUpdate.save')}
              </Button>
            </div>
          </Form>
        )}
      </section>
    </Flexbox>
  );
});

DistributionPage.displayName = 'DistributionPage';

export default DistributionPage;
