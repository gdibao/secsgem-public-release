'use client';

import { Flexbox } from '@lobehub/ui';
import { Form, InputNumber, Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const CHARGE_MODES = ['free', 'fixed', 'ai_usage', 'external_api', 'hybrid'] as const;

const BillingEditor = memo(() => {
  const { t } = useTranslation('common');
  const chargeModeOptions = CHARGE_MODES.map((value) => ({
    label: t(`moduleApps.admin.entitlements.chargeModeOptions.${value}`),
    value,
  }));

  return (
    <Flexbox data-testid="admin-module-app-billing-editor" gap={12}>
      <h3>{t('moduleApps.admin.entitlements.billing')}</h3>
      <p>{t('moduleApps.admin.entitlements.billingNotice')}</p>
      <Flexbox horizontal gap={12}>
        <Form.Item
          label={t('moduleApps.admin.entitlements.chargeMode')}
          name={['billing', 'chargeMode']}
          style={{ flex: 1 }}
        >
          <Select
            aria-label={t('moduleApps.admin.entitlements.chargeMode')}
            options={chargeModeOptions}
          />
        </Form.Item>
        <Form.Item
          label={t('moduleApps.admin.entitlements.defaultMultiplier')}
          name={['billing', 'defaultMultiplier']}
          style={{ flex: 1 }}
        >
          <InputNumber max={100} min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
      </Flexbox>
      <Flexbox horizontal gap={12}>
        <Form.Item
          label={t('moduleApps.admin.entitlements.fixedServiceFeeCredits')}
          name={['billing', 'fixedServiceFeeCredits']}
          style={{ flex: 1 }}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label={t('moduleApps.admin.entitlements.externalApiCostCredits')}
          name={['billing', 'externalApiCostCredits']}
          style={{ flex: 1 }}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
      </Flexbox>
      <Form.Item
        label={t('moduleApps.admin.entitlements.failureFixedFeePolicy')}
        name={['billing', 'failureFixedFeePolicy']}
      >
        <Select
          options={[
            {
              label: t('moduleApps.admin.entitlements.failureFixedFeePolicyOptions.doNotCharge'),
              value: 'do_not_charge',
            },
          ]}
        />
      </Form.Item>
    </Flexbox>
  );
});

BillingEditor.displayName = 'BillingEditor';

export default BillingEditor;
