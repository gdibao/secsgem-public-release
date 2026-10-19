'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Center, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { css, cx } from 'antd-style';
import { type FC, type PropsWithChildren, useEffect } from 'react';

import { usePublicDesktopClientConfig } from '@/features/DesktopDownload/usePublicDesktopClientConfig';
import SimpleTitleBar from '@/features/Electron/titlebar/SimpleTitleBar';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';

import { styles } from './style';

const contentContainer = css`
  overflow: auto;
`;

const DEFAULT_FOOTER_TEXT = '© 2026 无锡市驰拓信息科技有限公司';

const OnboardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const { loginConfig } = usePublicDesktopClientConfig();
  const footerText = loginConfig.footerText || DEFAULT_FOOTER_TEXT;

  useEffect(() => {
    if (!loginConfig.windowTitle) return;

    const previousTitle = document.title;
    document.title = loginConfig.windowTitle;

    return () => {
      document.title = previousTitle;
    };
  }, [loginConfig.windowTitle]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <SimpleTitleBar title={loginConfig.windowTitle} />
      <Flexbox
        className={styles.outerContainer}
        height={`calc(100% - ${TITLE_BAR_HEIGHT}px)`}
        style={{ paddingBottom: 8, paddingInline: 8 }}
        width={'100%'}
      >
        <Flexbox
          className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
          height={'100%'}
          width={'100%'}
        >
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            padding={16}
            width={'100%'}
          >
            <div />
            <Flexbox horizontal align={'center'}>
              <LangButton compact placement={'bottomRight'} />
              <Divider className={styles.divider} orientation={'vertical'} />
              <ThemeButton placement={'bottomRight'} size={18} />
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} className={cx(contentContainer)} height={'100%'} width={'100%'}>
            {children}
          </Flexbox>
          <Center padding={24}>
            <Text align={'center'} type={'secondary'}>
              {footerText}
            </Text>
          </Center>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default OnboardingContainer;
