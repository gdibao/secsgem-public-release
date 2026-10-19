'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { Save } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface CronJobSaveButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onSave: () => void;
}

const CronJobSaveButton = memo<CronJobSaveButtonProps>(({ disabled, loading, onSave }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal justify="flex-end">
      <Button
        disabled={disabled}
        icon={<Icon icon={Save} />}
        loading={loading}
        type="primary"
        onClick={onSave}
      >
        {t('agentCronJobs.create')}
      </Button>
    </Flexbox>
  );
});

export default CronJobSaveButton;
