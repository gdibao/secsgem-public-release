'use client';

import { createStaticStyles, cx } from 'antd-style';
import { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--mobile-grid-min-cell), 1fr));
    gap: 12px;
  `,
}));

interface MobileIconGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  minCellSize?: number;
}

const MobileIconGrid = ({
  children,
  className,
  minCellSize = 120,
  style,
  ...rest
}: MobileIconGridProps) => {
  const gridStyle = {
    '--mobile-grid-min-cell': `${minCellSize}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      {...rest}
      className={cx(styles.grid, className)}
      data-mobile-grid-min-cell={minCellSize}
      data-testid="mobile-icon-grid"
      style={gridStyle}
    >
      {children}
    </div>
  );
};

export default MobileIconGrid;
