'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    align-items: center;
  `,
}));

export interface MobileWorkspaceHeaderAction {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export interface MobileWorkspaceHeaderProps
  extends Omit<ComponentProps<typeof ChatHeader>, 'center' | 'right' | 'title'> {
  actions?: MobileWorkspaceHeaderAction[];
  center?: ReactNode;
  right?: ReactNode;
  title?: ReactNode;
}

const MobileWorkspaceHeader = ({
  actions = [],
  center,
  right,
  title,
  ...rest
}: MobileWorkspaceHeaderProps) => {
  const actionButtons = actions.length ? (
    <div className={styles.actions}>
      {actions.map((action, index) => (
        <ActionIcon
          aria-label={action.label}
          disabled={action.disabled}
          icon={action.icon}
          key={`${action.label}-${index}`}
          size={{ blockSize: 44, size: 20 }}
          title={action.label}
          onClick={action.onClick}
        />
      ))}
    </div>
  ) : undefined;

  return (
    <ChatHeader
      {...rest}
      center={title ? <ChatHeader.Title title={title} /> : center}
      right={
        right || actionButtons ? (
          <div className={styles.actions}>
            {right}
            {actionButtons}
          </div>
        ) : undefined
      }
    />
  );
};

export default MobileWorkspaceHeader;
