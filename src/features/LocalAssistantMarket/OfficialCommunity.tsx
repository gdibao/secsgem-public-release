import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { officialMarketUrl } from './catalog';

export default function OfficialCommunity() {
  const { t } = useTranslation('discover');
  const [expanded, setExpanded] = useState(false);
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary aria-expanded={expanded} data-testid="official-community-toggle">
        {t('localMarket.officialCommunity')}
      </summary>
      {expanded && (
        <a href={officialMarketUrl} rel="noopener noreferrer" target="_blank">
          {t('localMarket.officialExternal')} <ExternalLink aria-hidden size={16} />
        </a>
      )}
    </details>
  );
}
