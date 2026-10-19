import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';

const NAV_CLEARANCE = `var(--mobile-workspace-bottom-clearance, calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom)))`;

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  id = 'lobe-mobile-scroll-container',
  ...rest
}: MobileContentLayoutProps) => {
  const content = (
    <Flexbox
      height="100%"
      id={id}
      width="100%"
      style={{
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        ...style,
        paddingBottom: withNav ? NAV_CLEARANCE : style?.paddingBottom,
      }}
      {...rest}
    >
      {children}
    </Flexbox>
  );

  if (!header) return content;

  return (
    <Flexbox
      direction="vertical"
      height={'100%'}
      style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      {header}
      <Flexbox
        data-testid="mobile-content-scroll"
        flex={1}
        id={id}
        width="100%"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
          ...style,
          paddingBottom: withNav ? NAV_CLEARANCE : style?.paddingBottom,
        }}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default MobileContentLayout;
