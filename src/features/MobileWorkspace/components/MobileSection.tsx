'use client';

import { Button, type ButtonProps } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

const MOBILE_SECTION_ACTION_STYLE = { minHeight: 44, minWidth: 44 } satisfies CSSProperties;

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-height: 44px;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  trailing: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  title: css`
    margin: 0;

    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
}));

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface MobileSectionAction {
  disabled?: boolean;
  icon?: ButtonProps['icon'];
  label: ReactNode;
  loading?: boolean;
  onClick: () => void;
}

interface MobileSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  action?: MobileSectionAction;
  children: ReactNode;
  headingLevel?: HeadingLevel;
  title: ReactNode;
  trailing?: ReactNode;
}

const MobileSection = ({
  action,
  children,
  className,
  headingLevel = 2,
  title,
  trailing,
  ...rest
}: MobileSectionProps) => {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  return (
    <section {...rest} className={cx(styles.section, className)}>
      <div className={styles.header}>
        <Heading className={styles.title}>{title}</Heading>
        {action || trailing ? (
          <div className={styles.trailing}>
            {trailing}
            {action ? (
              <Button
                disabled={action.disabled}
                htmlType="button"
                icon={action.icon}
                loading={action.loading}
                size="large"
                style={MOBILE_SECTION_ACTION_STYLE}
                type="text"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
};

export default MobileSection;
