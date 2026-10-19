'use client';

import { createStaticStyles, cx } from 'antd-style';
import { type HTMLAttributes, type ReactNode } from 'react';

import { MOBILE_WORKSPACE_CONTENT_MAX_WIDTH } from '@/const/layoutTokens';

const styles = createStaticStyles(({ css }) => ({
  frame: css`
    box-sizing: border-box;
    width: 100%;
    max-width: ${MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}px;
    margin-inline: auto;
    padding-inline: 12px;

    @media (width >= 480px) {
      padding-inline: 16px;
    }
  `,
}));

interface MobileContentFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const MobileContentFrame = ({ children, className, ...rest }: MobileContentFrameProps) => (
  <div
    {...rest}
    className={cx(styles.frame, className)}
    data-mobile-content-max-width={MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}
    data-testid="mobile-content-frame"
  >
    {children}
  </div>
);

export default MobileContentFrame;
