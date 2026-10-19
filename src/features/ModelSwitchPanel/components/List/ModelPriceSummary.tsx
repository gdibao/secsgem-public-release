import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { getCachedTextInputUnitRate } from '@lobechat/utils';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ArrowDownToDot, ArrowUpFromDot, CircleFadingArrowUp } from 'lucide-react';
import type { Pricing } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { getTextPriceSummary } from '@/features/ModelSwitchPanel/hooks/useModelDetailPanel';
import { getUnitRateByName } from '@/utils/index';

interface ModelPriceSummaryProps {
  modelId: string;
  pricing?: Pricing;
  provider: string;
}

const ModelPriceSummary = memo<ModelPriceSummaryProps>(({ modelId, pricing, provider }) => {
  const { t } = useTranslation('components');
  const applyBusinessModelPricing = useBusinessModelPricing();
  const displayPricing = useMemo(
    () => applyBusinessModelPricing({ model: modelId, pricing, provider }),
    [applyBusinessModelPricing, modelId, pricing, provider],
  );
  const isCreditPricing = provider === BRANDING_PROVIDER;
  const price = displayPricing ? getTextPriceSummary(displayPricing, isCreditPricing) : undefined;

  const rates = useMemo(() => {
    if (!displayPricing) return undefined;

    return {
      cachedInput: typeof getCachedTextInputUnitRate(displayPricing) === 'number',
      input: typeof getUnitRateByName(displayPricing, 'textInput') === 'number',
      output: typeof getUnitRateByName(displayPricing, 'textOutput') === 'number',
    };
  }, [displayPricing]);

  if (!price || !rates) return null;

  const formatAmount = (amount: string) => (isCreditPricing ? amount : `${amount}/M`);
  const getTooltip = (key: 'cachedInput' | 'input' | 'output', amount: string) =>
    t(
      isCreditPricing
        ? `ModelSwitchPanel.detail.pricing.credits.${key}`
        : key === 'cachedInput'
          ? 'ModelSwitchPanel.detail.pricing.cachedInput'
          : `ModelSwitchPanel.detail.pricing.${key}`,
      { amount },
    );

  return (
    <Flexbox horizontal align="center" gap={6} style={{ color: 'var(--ant-color-text-tertiary)' }}>
      {rates.cachedInput && (
        <Tooltip title={getTooltip('cachedInput', price.cachedInput.current)}>
          <Flexbox horizontal align="center" gap={2}>
            <Icon icon={CircleFadingArrowUp} size="small" />
            <span>{formatAmount(price.cachedInput.current)}</span>
          </Flexbox>
        </Tooltip>
      )}
      {rates.input && (
        <Tooltip title={getTooltip('input', price.input.current)}>
          <Flexbox horizontal align="center" gap={2}>
            <Icon icon={ArrowUpFromDot} size="small" />
            <span>{formatAmount(price.input.current)}</span>
          </Flexbox>
        </Tooltip>
      )}
      {rates.output && (
        <Tooltip title={getTooltip('output', price.output.current)}>
          <Flexbox horizontal align="center" gap={2}>
            <Icon icon={ArrowDownToDot} size="small" />
            <span>{formatAmount(price.output.current)}</span>
          </Flexbox>
        </Tooltip>
      )}
    </Flexbox>
  );
});

ModelPriceSummary.displayName = 'ModelPriceSummary';

export default ModelPriceSummary;
