import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { CrownIcon, HeartIcon, HomeIcon, LibraryBigIcon, PlugZapIcon, SearchIcon, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getRouteById } from '@/config/routes';
import { PUBLIC_EXPERT_PLAZA_SWR_KEY } from '@/const/adminCacheKeys';
import { ENGINEERING_TOOL_DESTINATIONS, resolveEngineeringToolMenu } from '@/const/engineeringToolDestination';
import { DEFAULT_EXPERT_PLAZA_CONFIG } from '@/const/expertPlaza';
import { useBrand } from '@/features/Brand';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { adminCommercialService } from '@/services/adminCommercial';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export interface NavItem {
  hidden?: boolean;
  icon: any;
  isNew?: boolean;
  key: string;
  onClick?: () => void;
  title: string;
  url?: string;
}

export interface NavLayout {
  bottomMenuItems: NavItem[];
  footer: {
    hideGitHub: boolean;
    layout: 'expanded' | 'compact';
    showEvalEntry: boolean;
    showSettingsEntry: boolean;
  };
  topNavItems: NavItem[];
  userPanel: {
    showDataImporter: boolean;
    showMemory: boolean;
  };
}

export const useNavLayout = (): NavLayout => {
  const { t } = useTranslation('common');
  const brand = useBrand();
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { hideGitHub } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const adminRole = useUserStore((state) => userProfileSelectors.userProfile(state)?.role);
  const canOpenDifyStudio =
    hasAdminCapability(adminRole, ADMIN_CAPABILITIES.systemWrite) ||
    hasAdminCapability(adminRole, ADMIN_CAPABILITIES.moduleAppWrite);
  const { data: canvas } = useSWR(
    activeWorkspaceSlug ? ['dify-canvas-nav', activeWorkspaceSlug] : null,
    () => lambdaClient.difyCanvas.list.query(),
    { revalidateOnFocus: true },
  );
  const { data: canvasAdmin } = useSWR(
    activeWorkspaceSlug && canOpenDifyStudio
      ? ['dify-canvas-admin-nav', activeWorkspaceSlug]
      : null,
    () => lambdaClient.difyCanvas.adminList.query(),
    { revalidateOnFocus: true },
  );
  const { data: globalCanvasAdmin } = useSWR(
    canOpenDifyStudio ? 'dify-canvas-admin-entry' : null,
    () => lambdaClient.difyCanvas.adminEntry.query(),
    { revalidateOnFocus: true },
  );
  const { data: engineeringMenu, error: engineeringMenuError, isLoading: engineeringMenuLoading } = useSWR(
    'engineering-tools-menu',
    () => lambdaClient.engineeringTools.menu.query(),
    { revalidateOnFocus: true },
  );
  const { data: expertPlazaConfig } = useClientDataSWR(
    enableBusinessFeatures ? PUBLIC_EXPERT_PLAZA_SWR_KEY : null,
    () => adminCommercialService.getPublicExpertPlaza(),
    { revalidateOnFocus: false },
  );
  const expertPlaza = expertPlazaConfig ?? DEFAULT_EXPERT_PLAZA_CONFIG;

  const topNavItems = useMemo(
    () =>
      [
        {
          icon: HomeIcon,
          key: SidebarTabKey.Home,
          title: t('tab.home'),
          url: '/',
        },
        {
          icon: CrownIcon,
          key: SidebarTabKey.Member,
          title: brand.sidebarMemberLabel || '会员',
          url: brand.sidebarMemberUrl || '/settings/plans',
        },
        {
          icon: SearchIcon,
          key: 'search',
          onClick: () => toggleCommandMenu(true),
          title: t('tab.search'),
        },
        {
          icon: getRouteById('tasks')!.icon,
          key: SidebarTabKey.Tasks,
          title: t('tab.tasks'),
          url: '/tasks',
        },
        {
          icon: getRouteById('resource')!.icon,
          key: SidebarTabKey.Resource,
          title: t('tab.resource'),
          url: '/resource',
        },
        ...((canvas?.available && canvas.workflows.length > 0) ||
        (canOpenDifyStudio && (canvasAdmin?.available || globalCanvasAdmin?.available))
          ? [
              {
                icon: Workflow,
                key: 'dify-canvas',
                title: 'AI 流程 / Dify',
                url: '/settings/dify-canvas',
              },
            ]
          : []),
      ] as NavItem[],
    [
      brand.sidebarMemberLabel,
      brand.sidebarMemberUrl,
      canvas?.available,
      canvas?.workflows.length,
      canvasAdmin?.available,
      globalCanvasAdmin?.available,
      globalCanvasAdmin?.url,
      activeWorkspaceSlug,
      canOpenDifyStudio,
      t,
      toggleCommandMenu,
    ],
  );

  const bottomMenuItems = useMemo(
    () => {
      const configured = resolveEngineeringToolMenu(engineeringMenu);
      const engineeringItems = configured.length
        ? configured.map((item) => ({
            hidden: !item.enabled,
            icon: item.key === 'favorites' ? HeartIcon : item.key === 'local_mcp' ? PlugZapIcon : LibraryBigIcon,
            key: item.key,
            title: item.label,
            url: item.path,
          }))
        : engineeringMenu === null || (engineeringMenu === undefined && !engineeringMenuLoading && !engineeringMenuError)
          ? [{ icon: LibraryBigIcon, key: 'catalog', title: '工程工具', url: ENGINEERING_TOOL_DESTINATIONS.catalog }]
          : [];
      return [
        ...engineeringItems,
        {
          hidden: !enableBusinessFeatures || !expertPlaza.enabled,
          icon: getRouteById('experts')!.icon,
          key: SidebarTabKey.Experts,
          title: expertPlaza.name || t('tab.experts'),
          url: '/experts',
        },
        {
          icon: getRouteById('page')!.icon,
          key: SidebarTabKey.Pages,
          title: t('tab.pages'),
          url: '/page',
        },
        {
          hidden: !!activeWorkspaceSlug,
          icon: getRouteById('memory')!.icon,
          key: SidebarTabKey.Memory,
          title: t('tab.memory'),
          url: '/memory',
        },
      ] as NavItem[];
    },
    [
      t,
      engineeringMenu,
      engineeringMenuError,
      engineeringMenuLoading,
      activeWorkspaceSlug,
      enableBusinessFeatures,
      expertPlaza.enabled,
      expertPlaza.name,
    ],
  );

  const footer = useMemo(
    () => ({
      hideGitHub: !!hideGitHub,
      layout: 'compact' as const,
      showEvalEntry: false,
      showSettingsEntry: true,
    }),
    [hideGitHub],
  );

  const userPanel = useMemo(
    () => ({
      showDataImporter: false,
      // Memory now appears in the sidebar by default; drop the duplicate entry
      // from the user dropdown to keep that menu focused on account / settings.
      showMemory: false,
    }),
    [],
  );

  return { bottomMenuItems, footer, topNavItems, userPanel };
};
