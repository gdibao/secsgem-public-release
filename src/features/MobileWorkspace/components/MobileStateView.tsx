'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';

const MOBILE_STATE_ACTION_STYLE = { minHeight: 44, minWidth: 44 } satisfies CSSProperties;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  `,
  description: css`
    max-width: 360px;
    margin: 0;

    font-size: 14px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  state: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    min-height: 180px;
    padding-block: 24px;
    padding-inline: 16px;

    text-align: center;

    @media (height <= 500px) {
      gap: 4px;
      min-height: 72px;
      padding-block: 0;
    }
  `,
  title: css`
    margin: 0;

    font-size: 17px;
    font-weight: 600;
    line-height: 24px;
    color: ${cssVar.colorText};
  `,
}));

export interface MobileStateAction {
  disabled?: boolean;
  label: ReactNode;
  loading?: boolean;
  onClick: () => void;
  primary?: boolean;
}

export interface MobileStateViewProps {
  action?: MobileStateAction;
  actions?: MobileStateAction[];
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  variant?: 'empty' | 'error' | 'loading';
}

const MobileStateView = ({
  action,
  actions = [],
  description,
  icon,
  title,
  variant = 'empty',
}: MobileStateViewProps) => {
  const stateActions = [
    ...(action ? [{ ...action, primary: action.primary ?? true }] : []),
    ...actions,
  ];
  let hasPrimaryAction = false;

  return (
    <section className={styles.state} data-testid="mobile-state-view" data-variant={variant}>
      {icon}
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {stateActions.length ? (
        <div className={styles.actions}>
          {stateActions.map((stateAction, index) => {
            const primary = Boolean(stateAction.primary) && !hasPrimaryAction;
            hasPrimaryAction ||= primary;

            return (
              <Button
                data-testid={primary ? 'mobile-state-primary-action' : undefined}
                disabled={stateAction.disabled}
                htmlType="button"
                key={index}
                loading={stateAction.loading}
                size="large"
                style={MOBILE_STATE_ACTION_STYLE}
                type={primary ? 'primary' : 'default'}
                onClick={stateAction.onClick}
              >
                {stateAction.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default MobileStateView;
