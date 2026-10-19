'use client';

import { Button } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type FC, type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    min-height: 44px;
  `,
  content: css`
    width: 100%;
    max-width: 1024px;
    margin-inline: auto;
  `,
  root: css`
    position: fixed;
    z-index: ${cssVar.zIndexPopupBase};
    inset-block-end: 0;
    inset-inline: 0;

    box-sizing: border-box;
    width: 100%;
    padding-block: 10px calc(10px + env(safe-area-inset-bottom, 0px));
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

export interface BusinessMobilePrimaryAction {
  href?: string;
  label: ReactNode;
  loading?: boolean;
  onClick?: () => void;
}

export const isBusinessMobilePrimaryActionExecutable = (
  action?: BusinessMobilePrimaryAction,
): action is BusinessMobilePrimaryAction => Boolean(action?.href || action?.onClick);

interface BusinessMobileActionBarProps {
  action: BusinessMobilePrimaryAction;
}

const BusinessMobileActionBar: FC<BusinessMobileActionBarProps> = ({ action }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (
    !mounted ||
    typeof document === 'undefined' ||
    !isBusinessMobilePrimaryActionExecutable(action)
  )
    return null;

  return createPortal(
    <div className={styles.root} data-safe-area="true" data-testid="business-mobile-action-bar">
      <div className={styles.content}>
        <Button
          block
          className={styles.action}
          href={action.href}
          loading={action.loading}
          type="primary"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      </div>
    </div>,
    document.body,
  );
};

export default BusinessMobileActionBar;
