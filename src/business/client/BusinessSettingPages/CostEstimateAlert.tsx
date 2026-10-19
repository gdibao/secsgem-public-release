'use client';

import { Alert } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const CostEstimateAlert = memo(() => {
  const { t } = useTranslation('subscription');

  return <Alert showIcon message={t('credits.costEstimateHint.unavailable')} type="info" />;
});

CostEstimateAlert.displayName = 'CostEstimateAlert';
export default CostEstimateAlert;
