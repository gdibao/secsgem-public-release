import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import InputNumber from './InputNumber';

const SeedNumberInput = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue } = useGenerationConfigParam('seed');
  const setSeedValue = setValue as unknown as (value: number | null | undefined) => void;

  return (
    <InputNumber placeholder={t('config.seed.random')} value={value} onChange={setSeedValue} />
  );
});

export default SeedNumberInput;
