'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    cursor: pointer;

    display: grid;
    place-items: center;

    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;

    color: ${cssVar.colorText};

    background: transparent;

    &:disabled {
      cursor: wait;
      opacity: 0.6;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  loading: css`
    animation: mobile-refresh-spin 1s linear infinite;

    @keyframes mobile-refresh-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

const MobileRefreshButton = memo(
  ({ label, loading, onRefresh }: { label: string; loading: boolean; onRefresh: () => void }) => (
    <button
      aria-busy={loading}
      aria-label={label}
      className={styles.button}
      disabled={loading}
      title={label}
      type="button"
      onClick={onRefresh}
    >
      <Icon className={loading ? styles.loading : undefined} icon={RefreshCw} size={20} />
    </button>
  ),
);

MobileRefreshButton.displayName = 'MobileRefreshButton';

export default MobileRefreshButton;
