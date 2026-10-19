'use client';

import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Menu, type MenuProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  ChartNoAxesColumn,
  Coins,
  Compass,
  CreditCard,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  Megaphone,
  MessageSquareText,
  Package,
  Plug,
  Presentation,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tags,
  Ticket,
  Users,
  Wrench,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  type AdminNavGroup,
  type AdminNavIcon,
  filterAdminNavGroups,
  getAdminNavGroupsForRole,
  getAdminNavigationContext,
  getAdminOpenKeys,
  getAdminSelectedKey,
} from './adminNavigation';

const styles = createStaticStyles(({ css, cssVar }) => ({
  brand: css`
    display: flex;
    flex-direction: column;
    justify-content: center;

    min-width: 0;
    min-height: 64px;
    padding-block: 14px 10px;
    padding-inline: 16px;
  `,
  brandCaption: css`
    overflow: hidden;

    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  brandTitle: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 24px;
    color: ${cssVar.colorText};
  `,
  empty: css`
    padding-block: 24px;
    padding-inline: 16px;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  footer: css`
    padding-block: 10px 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  footerButton: css`
    justify-content: flex-start;
    width: 100%;
  `,
  menu: css`
    border-inline-end: 0 !important;
    background: transparent !important;
  `,
  navigation: css`
    scrollbar-gutter: stable;
    overflow-y: auto;
    min-height: 0;
    padding-block-end: 8px;
  `,
  root: css`
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
  search: css`
    width: 100%;
    height: 34px;
    padding-block: 0;
    padding-inline: 34px 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};

    font: inherit;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextTertiary};
    }

    &:focus-visible {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  searchIcon: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 9px;
    inset-inline-start: 10px;

    color: ${cssVar.colorTextTertiary};
  `,
  searchWrap: css`
    position: relative;
    margin-block: 0 10px;
    margin-inline: 12px;
  `,
}));

const iconMap: Record<AdminNavIcon, typeof Gauge> = {
  'audit': FileText,
  'billing': CreditCard,
  'credits': Coins,
  'desktop': Download,
  'documents': FileText,
  'expert-plaza': Compass,
  'file-storage': HardDrive,
  'files': FileArchive,
  'growth': ShieldCheck,
  'maintenance': Wrench,
  'mobile': Smartphone,
  'models': SlidersHorizontal,
  'notifications': Bell,
  'orders': ReceiptText,
  'overview': Gauge,
  'plans': Package,
  'plugins': Plug,
  'ppt': Presentation,
  'pricing': Tags,
  'providers': Plug,
  'redemption': Ticket,
  'recommendations': Sparkles,
  'settings': Megaphone,
  'stats': BarChart3,
  'subscriptions': ChartNoAxesColumn,
  'system-defaults': FolderOpen,
  'topup': CreditCard,
  'topics': MessageSquareText,
  'users': Users,
};

const buildMenuItems = (
  groups: AdminNavGroup[],
  statusLabel: Record<'deprecated' | 'experimental' | 'planned', string>,
  translate: (key: string, fallback: string) => string,
): MenuProps['items'] =>
  groups.map((group) => ({
    children: group.items.map((item) => ({
      icon: <Icon icon={iconMap[item.icon]} />,
      key: item.path,
      label:
        item.status === 'active' ? (
          translate(`admin.navigation.items.${item.id}.label`, item.label)
        ) : (
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <span>{translate(`admin.navigation.items.${item.id}.label`, item.label)}</span>
            {item.status === 'experimental' || item.status === 'deprecated' ? (
              <Tag color={item.status === 'deprecated' ? 'gold' : 'blue'}>
                {statusLabel[item.status]}
              </Tag>
            ) : null}
          </Flexbox>
        ),
      title: translate(`admin.navigation.items.${item.id}.description`, item.description),
    })),
    icon: <Icon icon={iconMap[group.icon]} />,
    key: group.key,
    label: `${translate(`admin.navigation.groups.${group.key}.label`, group.label)} (${group.items.length})`,
    title: translate(`admin.navigation.groups.${group.key}.description`, group.description),
  }));

const AdminSidebar = memo<{ onNavigate?: () => void }>(({ onNavigate }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('subscription');
  const role = useUserStore((state) => (userProfileSelectors.userProfile(state) as any)?.role);
  const groups = useMemo(() => getAdminNavGroupsForRole(role), [role]);
  const context = useMemo(
    () => getAdminNavigationContext(role, location.pathname),
    [location.pathname, role],
  );
  const routeOpenKeys = useMemo(() => getAdminOpenKeys(location.pathname), [location.pathname]);
  const [openKeys, setOpenKeys] = useState<string[]>(routeOpenKeys);
  const [query, setQuery] = useState('');
  const filteredGroups = useMemo(() => filterAdminNavGroups(groups, query), [groups, query]);

  useEffect(() => setOpenKeys(routeOpenKeys), [routeOpenKeys]);

  const items = useMemo(
    () =>
      buildMenuItems(
        filteredGroups,
        {
          deprecated: t('admin.navigation.status.deprecated'),
          experimental: t('admin.navigation.status.experimental'),
          planned: t('admin.navigation.status.planned'),
        },
        (key, fallback) => t(key, { defaultValue: fallback }),
      ),
    [filteredGroups, t],
  );
  const selectedKey = getAdminSelectedKey(location.pathname);
  const visibleOpenKeys = query ? filteredGroups.map((group) => group.key) : openKeys;

  return (
    <div className={styles.root}>
      <header className={styles.brand}>
        <span className={styles.brandTitle}>{t('admin.navigation.title', '管理后台')}</span>
        <span className={styles.brandCaption}>
          {context
            ? t(`admin.navigation.items.${context.item.id}.description`, {
                defaultValue: context.item.description,
              })
            : t('admin.navigation.caption', '统一管理平台能力')}
        </span>
      </header>
      <label className={styles.searchWrap}>
        <Search aria-hidden className={styles.searchIcon} size={16} />
        <input
          aria-label={t('admin.navigation.search', '搜索管理功能')}
          className={styles.search}
          placeholder={t('admin.navigation.searchPlaceholder', '搜索页面或功能...')}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav aria-label={t('admin.navigation.title', '管理后台')} className={styles.navigation}>
        {filteredGroups.length > 0 ? (
          <Menu
            className={styles.menu}
            items={items}
            mode="inline"
            openKeys={visibleOpenKeys}
            selectedKeys={[selectedKey]}
            onClick={({ key }: { key: string }) => {
              navigate(key);
              onNavigate?.();
            }}
            onOpenChange={(keys) => {
              if (!query) setOpenKeys(keys as string[]);
            }}
          />
        ) : (
          <div className={styles.empty}>
            {t('admin.navigation.noResults', '未找到匹配的管理功能')}
          </div>
        )}
      </nav>
      <footer className={styles.footer}>
        <Button
          className={styles.footerButton}
          onClick={() => {
            navigate('/');
            onNavigate?.();
          }}
        >
          <ArrowLeft aria-hidden size={16} />
          {t('admin.navigation.backToApp', '返回前台')}
        </Button>
      </footer>
    </div>
  );
});

AdminSidebar.displayName = 'AdminSidebar';

export default AdminSidebar;
