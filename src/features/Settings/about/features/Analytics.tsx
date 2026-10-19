'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useBrandName } from '@/features/Brand';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const Analytics = memo(() => {
  const { t } = useTranslation('setting');
  const brandName = useBrandName();
  const checked = useUserStore(userGeneralSettingsSelectors.telemetry);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const items: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={!!checked}
            onChange={(e) => {
              updateGeneralConfig({ telemetry: e });
            }}
          />
        ),
        desc: t('analytics.telemetry.desc', { appName: brandName }),
        label: t('analytics.telemetry.title'),
        minWidth: undefined,
        valuePropName: 'checked',
      },
    ],
    title: t('analytics.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[items]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default Analytics;
