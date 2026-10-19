'use client';

import { Flexbox } from '@lobehub/ui';
import { McpIcon, ProviderIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Bot, Brain, ShapesIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { DiscoverTab } from '@/types/discover';
import { isModifierClick } from '@/utils/navigation';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  if (pathname.endsWith('/community')) return 'local-market';
  if (pathname.includes('/community/agent')) return DiscoverTab.Assistants;
  if (pathname.includes('/community/skill')) return 'local-skills';
  if (pathname.includes('/community/mcp')) return 'local-mcp';
  if (pathname.includes('/community/model')) return 'local-models';
  if (pathname.includes('/community/provider')) return 'local-providers';
  return DiscoverTab.Home;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');

  const items: Item[] = useMemo(
    () =>
      [
        {
          icon: ShapesIcon,
          key: 'local-market',
          title: t('localMarket.nav.market'),
          url: '/community',
        },
        {
          icon: Bot,
          key: DiscoverTab.Assistants,
          title: t('localMarket.nav.assistants'),
          url: '/community/agent',
        },
        {
          icon: SkillsIcon,
          key: 'local-skills',
          title: t('localMarket.nav.skills'),
          url: '/community/skill',
        },
        {
          icon: McpIcon,
          key: 'local-mcp',
          title: t('localMarket.nav.mcp'),
          url: '/community/mcp',
        },
        {
          icon: Brain,
          key: 'local-models',
          title: t('localMarket.nav.models'),
          url: '/community/model',
        },
        {
          icon: ProviderIcon,
          key: 'local-providers',
          title: t('localMarket.nav.providers'),
          url: '/community/provider',
        },
      ] as Item[],
    [t],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        return (
          <WorkspaceLink
            key={item.key}
            to={item.url}
            onClick={(e) => {
              if (isModifierClick(e)) return;
              e.preventDefault();
              item?.onClick?.();
              if (item.url) {
                navigate(item.url);
              }
            }}
          >
            <NavItem active={tab.startsWith(item.key)} icon={item.icon} title={item.title} />
          </WorkspaceLink>
        );
      })}
    </Flexbox>
  );
});

export default Nav;
