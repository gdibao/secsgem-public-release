'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox, Text } from '@lobehub/ui';
import { type FC } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { electronStylish } from '@/styles/electron';
import { getPlatform, isMacOS } from '@/utils/platform';

import { useWatchThemeUpdate } from '../system/useWatchThemeUpdate';
import WinControl, { WINDOW_CONTROL_WIDTH } from './WinControl';

const isMac = isMacOS();
const isLinux = getPlatform() === 'Linux';

/**
 * A simple, minimal TitleBar for Electron windows.
 * Provides draggable area without business logic (navigation, updates, etc.)
 * Use this for secondary windows like onboarding, settings, etc.
 */
type SimpleTitleBarProps = {
  title?: string;
};

const SimpleTitleBar: FC<SimpleTitleBarProps> = ({ title }) => {
  useWatchThemeUpdate();

  const showWinControl = isLinux && !isMac;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={electronStylish.draggable}
      height={TITLE_BAR_HEIGHT}
      justify={showWinControl ? 'space-between' : 'center'}
      style={{ minHeight: TITLE_BAR_HEIGHT, padding: '0 12px' }}
      width={'100%'}
    >
      {showWinControl && <div style={{ width: WINDOW_CONTROL_WIDTH }} />}
      {title ? (
        <Text
          as={'span'}
          ellipsis
          style={{ maxWidth: 240, minWidth: 0, textAlign: 'center' }}
          weight={'bold'}
        >
          {title}
        </Text>
      ) : (
        <ProductLogo size={16} type={'text'} />
      )}
      {showWinControl && <WinControl />}
    </Flexbox>
  );
};

export default SimpleTitleBar;
