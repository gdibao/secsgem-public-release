'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const COMMUNITY_LIST_TYPES = new Set(['agent', 'mcp', 'model', 'provider', 'skill']);

export const resolveCommunityListPath = (pathname: string) => {
  const path = pathname.split('/').filter(Boolean);
  const communityIndex = path.indexOf('community');
  const detailType = communityIndex >= 0 ? path[communityIndex + 1] : undefined;

  if (detailType === 'group_agent') return '/community/agent';
  return detailType && COMMUNITY_LIST_TYPES.has(detailType)
    ? `/community/${detailType}`
    : '/community';
};

const Header = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      onBackClick={() => navigate(resolveCommunityListPath(location.pathname))}
    />
  );
});

export default Header;
