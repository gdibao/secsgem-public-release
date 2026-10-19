'use client';

import { createStaticStyles } from 'antd-style';
import { type CSSProperties } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    flex: 0 0 var(--mobile-list-skeleton-avatar-size);

    width: var(--mobile-list-skeleton-avatar-size);
    height: var(--mobile-list-skeleton-avatar-size);
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  body: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
  `,
  line: css`
    height: 14px;
    border-radius: 4px;
    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;

    min-height: var(--mobile-list-skeleton-min-row-height);
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trailing: css`
    flex: 0 0 var(--mobile-list-skeleton-trailing-width);

    width: var(--mobile-list-skeleton-trailing-width);
    height: 14px;
    border-radius: 4px;

    background: ${cssVar.colorFillTertiary};
  `,
}));

const DEFAULT_AVATAR_SIZE = 40;
const DEFAULT_MIN_ROW_HEIGHT = 64;
const DEFAULT_TRAILING_WIDTH = 20;

type MobileListSkeletonStyle = CSSProperties & {
  '--mobile-list-skeleton-avatar-size': string;
  '--mobile-list-skeleton-min-row-height': string;
  '--mobile-list-skeleton-trailing-width': string;
};

export interface MobileListSkeletonProps {
  avatarSize?: number;
  className?: string;
  label: string;
  minRowHeight?: number;
  rows?: number;
  trailingWidth?: number;
}

const MobileListSkeleton = ({
  avatarSize = DEFAULT_AVATAR_SIZE,
  className,
  label,
  minRowHeight = DEFAULT_MIN_ROW_HEIGHT,
  rows = 4,
  trailingWidth = DEFAULT_TRAILING_WIDTH,
}: MobileListSkeletonProps) => {
  const rowCount = Math.max(0, Math.trunc(rows));
  const geometry: MobileListSkeletonStyle = {
    '--mobile-list-skeleton-avatar-size': `${avatarSize}px`,
    '--mobile-list-skeleton-min-row-height': `${minRowHeight}px`,
    '--mobile-list-skeleton-trailing-width': `${trailingWidth}px`,
  };

  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={className}
      data-testid="mobile-list-skeleton"
      role="status"
      style={geometry}
    >
      {Array.from({ length: rowCount }, (_, index) => (
        <div
          aria-hidden="true"
          className={styles.row}
          data-testid="mobile-list-skeleton-row"
          key={index}
        >
          <div className={styles.avatar} />
          <div className={styles.body}>
            <div className={styles.line} style={{ width: index === rowCount - 1 ? '56%' : '72%' }} />
            <div className={styles.line} style={{ width: '40%' }} />
          </div>
          <div className={styles.trailing} />
        </div>
      ))}
    </div>
  );
};

export default MobileListSkeleton;
