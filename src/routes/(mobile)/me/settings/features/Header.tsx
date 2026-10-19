'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('common');

  const navigate = useWorkspaceAwareNavigate();
  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={4}>
              {t('userPanel.setting')}
            </Flexbox>
          }
        />
      }
      onBackClick={() => navigate('/me', { escape: true })}
    />
  );
});

export default Header;
