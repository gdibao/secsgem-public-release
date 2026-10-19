'use client';

import { createStaticStyles, cx } from 'antd-style';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    color: ${cssVar.colorText};
    font-weight: 600;

    &::after {
      content: '';

      position: absolute;
      inset-block-end: 0;
      inset-inline: 12px;

      height: 2px;

      background: ${cssVar.colorPrimary};
    }
  `,
  root: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    width: 100%;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  scroller: css`
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;

    padding-inline: 16px;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  tab: css`
    cursor: pointer;

    position: relative;

    flex: 0 0 auto;

    height: 44px;
    padding: 0 16px;
    border: 0;

    font: inherit;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    appearance: none;
    background: transparent;
  `,
}));

const tabs = [
  { key: SettingsTabs.Plans, labelKey: 'tab.plans' },
  { key: SettingsTabs.Credits, labelKey: 'tab.credits' },
  { key: SettingsTabs.Billing, labelKey: 'tab.billing' },
  { key: SettingsTabs.Usage, labelKey: 'tab.usage' },
  { key: SettingsTabs.Referral, labelKey: 'tab.referral' },
] as const;

export const BusinessMobileTabs = memo(() => {
  const { t } = useTranslation('subscription');
  const { pathname } = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTab = pathname.split('/').filter(Boolean).at(-1);

  useEffect(() => {
    const container = containerRef.current;
    const active = container?.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`);
    if (!active || !container) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < containerRect.left || activeRect.right > containerRect.right) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTab]);

  const changeTab = (tab: string) => {
    document.getElementById('lobe-mobile-scroll-container')?.scrollTo({ behavior: 'auto', top: 0 });
    navigate(`/settings/${tab}`, { escape: true });
  };

  return (
    <div aria-label={t('mobile.tabs.ariaLabel')} className={styles.root} role="tablist">
      <div className={styles.scroller} ref={containerRef}>
        {tabs.map(({ key, labelKey }) => (
          <button
            aria-selected={activeTab === key}
            className={cx(styles.tab, activeTab === key && styles.active)}
            data-tab-id={key}
            key={key}
            role="tab"
            type="button"
            onClick={() => changeTab(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
});

BusinessMobileTabs.displayName = 'BusinessMobileTabs';

export default BusinessMobileTabs;
