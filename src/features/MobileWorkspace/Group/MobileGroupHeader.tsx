'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

const MobileGroupHeader = memo(() => {
  const { t } = useTranslation('common');
  const { gid } = useParams<{ gid?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const group = useSessionStore(sessionGroupSelectors.getGroupById(gid ?? ''));

  return (
    <ChatHeader
      center={
        <ChatHeader.Title
          title={group?.name || t('navigation.groupChat', { defaultValue: 'Group chat' })}
        />
      }
      showBackButton
      style={{ width: '100%' }}
      onBackClick={() => navigate('/')}
    />
  );
});

export default MobileGroupHeader;
