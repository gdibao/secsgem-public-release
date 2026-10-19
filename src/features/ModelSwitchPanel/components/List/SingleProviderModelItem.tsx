import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { type ModelWithProviders } from '../../types';
import ModelPriceSummary from './ModelPriceSummary';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
  proBadgeLabel?: string;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(
  ({ data, newLabel, proBadgeLabel }) => {
    return (
      <ModelItemRender
        {...data.model}
        {...data.model.abilities}
        wrapInfo
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        priceLabel={
          <ModelPriceSummary
            modelId={data.model.id}
            pricing={data.model.pricing}
            provider={data.providers[0].id}
          />
        }
      />
    );
  },
);

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
