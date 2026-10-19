'use client';

import { Icon } from '@lobehub/ui';
import { Button, Segmented, Switch } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, InputNumber, message, Skeleton, Typography } from 'antd';
import { RefreshCw, Save } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeDesktopUpdateServerUrl } from '@/const/desktopUpdate';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminSettingsConflictAlert from '../shared/AdminSettingsConflictAlert';
import {
  buildUpdateSettingsUpdates,
  type DesktopSettingsValues,
  getDesktopSettingsValues,
  isDesktopFormValidationError,
} from './desktopSettingsForm';
import { desktopControlCenterStyles } from './styles';
import type { DesktopSettingsResource } from './types';
import { useDesktopSettingsFormSync } from './useDesktopSettingsFormSync';

const isAllowedUpdateServerUrl = (value?: string) => {
  return 'url' in normalizeDesktopUpdateServerUrl(value);
};

interface UpdateSettingsPageProps {
  onDirtyChange?: (dirty: boolean) => void;
  settings: DesktopSettingsResource;
}

const UpdateSettingsPage = memo<UpdateSettingsPageProps>(({ onDirtyChange, settings }) => {
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

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const updates = buildUpdateSettingsUpdates(initialValues, values, dirtyFields);
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

  if (settings.error) {
    return (
      <Alert
        message={t('admin.desktopControl.settingsError')}
        type="error"
        action={
          <Button icon={<Icon icon={RefreshCw} size={16} />} onClick={() => void settings.mutate()}>
            {t('admin.desktopControl.retry')}
          </Button>
        }
      />
    );
  }

  if (settings.isLoading && !settings.data) return <Skeleton active paragraph={{ rows: 6 }} />;

  return (
    <section className={desktopControlCenterStyles.formSection}>
      <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
        {t('admin.desktopControl.tabs.updates')}
      </Typography.Title>
      <AdminSettingsConflictAlert
        error={saveError}
        onReload={async () => {
          await settings.mutate();
          setSaveError(undefined);
        }}
      />
      <Form
        disabled={settings.isLoading || submitting}
        form={form}
        initialValues={initialValues}
        layout="vertical"
        onValuesChange={markEdited}
      >
        <Form.Item
          extra={t('admin.desktopUpdate.serverUrl.help')}
          label={t('admin.desktopUpdate.serverUrl')}
          name="serverUrl"
          rules={[
            {
              validator: (_rule, value: string | undefined) =>
                isAllowedUpdateServerUrl(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('admin.desktopControl.serverUrlInvalid'))),
            },
          ]}
        >
          <Input placeholder="https://releases.example.com" />
        </Form.Item>

        <Form.Item label={t('admin.desktopUpdate.channel')} name="channel">
          <Segmented
            block
            options={[
              { label: t('admin.desktopControl.status.stable'), value: 'stable' },
              { label: t('admin.desktopControl.status.canary'), value: 'canary' },
            ]}
          />
        </Form.Item>

        <Form.Item
          label={t('admin.desktopUpdate.autoCheck')}
          name="autoCheck"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          extra={t('admin.desktopUpdate.checkInterval.help')}
          label={t('admin.desktopUpdate.checkInterval')}
          name="checkInterval"
          rules={[{ max: 1440, min: 1, type: 'number' }]}
        >
          <InputNumber max={1440} min={1} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          extra={t('admin.desktopUpdate.currentVersion.help')}
          label={t('admin.desktopUpdate.currentVersion')}
          name="currentVersion"
        >
          <Input placeholder="2.3.0" />
        </Form.Item>

        <Form.Item
          extra={t('admin.desktopUpdate.releaseNotes.help')}
          label={t('admin.desktopUpdate.releaseNotes')}
          name="releaseNotes"
        >
          <Input.TextArea autoSize={{ maxRows: 10, minRows: 5 }} />
        </Form.Item>

        <div className={desktopControlCenterStyles.formActions}>
          <Button
            disabled={settings.isLoading}
            icon={<Icon icon={Save} size={16} />}
            loading={submitting}
            type="primary"
            onClick={() => void handleSave()}
          >
            {t('admin.desktopUpdate.save')}
          </Button>
        </div>
      </Form>
    </section>
  );
});

UpdateSettingsPage.displayName = 'UpdateSettingsPage';

export default UpdateSettingsPage;
