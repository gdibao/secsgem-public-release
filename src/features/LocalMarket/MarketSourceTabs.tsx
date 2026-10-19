import { styles } from './style';

export type MarketSource = 'fab' | 'local';

const MarketSourceTabs = ({
  fabLabel = 'FAB 市场',
  localLabel = '本地市场',
  source,
  onChange,
}: {
  fabLabel?: string;
  localLabel?: string;
  source: MarketSource;
  onChange: (source: MarketSource) => void;
}) => (
  <div aria-label="市场来源" className={styles.sourceTabs} role="tablist">
    <button
      aria-selected={source === 'fab'}
      className={source === 'fab' ? styles.sourceTabActive : styles.sourceTab}
      role="tab"
      type="button"
      onClick={() => onChange('fab')}
    >
      {fabLabel}
    </button>
    <button
      aria-selected={source === 'local'}
      className={source === 'local' ? styles.sourceTabActive : styles.sourceTab}
      role="tab"
      type="button"
      onClick={() => onChange('local')}
    >
      {localLabel}
    </button>
  </div>
);

export default MarketSourceTabs;
