'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert, Space, Typography } from 'antd';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AdminSettingsRevisionConflictError,
  getAdminSettingsSaveErrorDetails,
} from '@/services/adminCommercial';

type AdminSettingsConflictAlertProps = {
  error?: unknown;
  onReload: () => void | Promise<unknown>;
};

const AdminSettingsConflictAlert = memo<AdminSettingsConflictAlertProps>(({ error, onReload }) => {
  const { t } = useTranslation('subscription');
  if (!error) return null;

  const details =
    error instanceof AdminSettingsRevisionConflictError
      ? error.details
      : getAdminSettingsSaveErrorDetails(error);
  if (!details.isConflict) return null;

  return (
    <Alert
      showIcon
      message={t('admin.settingsConflict.title')}
      type="error"
      action={
        <Button icon={<Icon icon={RefreshCw} size={16} />} onClick={() => void onReload()}>
          {t('admin.settingsConflict.reload')}
        </Button>
      }
      description={
        <Space direction="vertical" size={2}>
          <Typography.Text>{t('admin.settingsConflict.description')}</Typography.Text>
          <Typography.Text code>
            {t('admin.settingsConflict.code')}: APP_SETTINGS_REVISION_CONFLICT
          </Typography.Text>
          {details.correlationId ? (
            <Typography.Text code>
              {t('admin.settingsConflict.correlationId')}: {details.correlationId}
            </Typography.Text>
          ) : null}
        </Space>
      }
    />
  );
});

AdminSettingsConflictAlert.displayName = 'AdminSettingsConflictAlert';

export default AdminSettingsConflictAlert;
