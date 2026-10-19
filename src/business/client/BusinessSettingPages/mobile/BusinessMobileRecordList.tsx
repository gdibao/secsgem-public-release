'use client';

import { ActionIcon, Button, Empty, Skeleton } from '@lobehub/ui';
import { FloatingSheet } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, X } from 'lucide-react';
import { type Key, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;

    box-sizing: border-box;
    width: 100%;
    min-height: 64px;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    appearance: none;
    background: ${cssVar.colorBgContainer};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  cardBody: css`
    min-width: 0;
  `,
  cardHeader: css`
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;

    min-width: 0;
  `,
  cardMeta: css`
    margin-block-start: 4px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  cardStatus: css`
    flex: none;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  cardTitle: css`
    overflow: hidden;
    min-width: 0;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cardValue: css`
    margin-block-start: 4px;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  `,
  details: css`
    display: grid;
    gap: 0;

    margin: 0;
    padding: 0 16px 24px;
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;

    padding-block: 24px;
  `,
  error: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;

    padding: 16px 0;

    color: ${cssVar.colorError};
  `,
  field: css`
    display: grid;
    grid-template-columns: minmax(96px, 0.8fr) minmax(0, 1.2fr);
    gap: 16px;

    padding-block: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    dt {
      color: ${cssVar.colorTextSecondary};
      overflow-wrap: anywhere;
    }

    dd {
      margin: 0;
      color: ${cssVar.colorText};
      text-align: end;
      overflow-wrap: anywhere;
    }
  `,
  list: css`
    display: grid;
    gap: 8px;
    min-width: 0;
  `,
  retry: css`
    min-height: 44px;
  `,
  skeleton: css`
    width: 100%;
    min-height: 64px;
  `,
  visuallyHidden: css`
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;

    white-space: nowrap;

    clip-path: inset(50%);
  `,
}));

export interface BusinessMobileRecordField {
  label: ReactNode;
  value: ReactNode;
}

export interface BusinessMobileRecord {
  fields: BusinessMobileRecordField[];
  id: Key;
  meta?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
}

export interface BusinessMobileRecordListProps {
  emptyAction?: ReactNode;
  emptyDescription: ReactNode;
  error?: ReactNode;
  isLoading?: boolean;
  onRetry?: () => void;
  records: BusinessMobileRecord[];
  sheetTitle: ReactNode;
}

const BusinessMobileRecordList = ({
  emptyAction,
  emptyDescription,
  error,
  isLoading,
  onRetry,
  records,
  sheetTitle,
}: BusinessMobileRecordListProps) => {
  const { t } = useTranslation('subscription');
  const [selectedRecord, setSelectedRecord] = useState<BusinessMobileRecord>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    setSelectedRecord(undefined);
    triggerRef.current?.focus();
  };

  let content: ReactNode;

  if (error) {
    content = (
      <div className={styles.error} role="alert">
        <div>{error}</div>
        {onRetry ? (
          <Button className={styles.retry} onClick={onRetry}>
            {t('mobile.error.retry')}
          </Button>
        ) : null}
      </div>
    );
  } else if (isLoading) {
    content = (
      <div aria-busy="true" className={styles.list}>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton.Button active block className={styles.skeleton} key={index} />
        ))}
      </div>
    );
  } else if (records.length === 0) {
    content = (
      <div className={styles.empty}>
        <Empty description={emptyDescription} />
        {emptyAction}
      </div>
    );
  } else {
    content = (
      <div className={styles.list}>
        {records.map((record) => (
          <button
            className={styles.card}
            key={record.id}
            type="button"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setSelectedRecord(record);
            }}
          >
            <span className={styles.visuallyHidden}>{t('mobile.records.viewDetails')}</span>
            <span className={styles.cardBody}>
              <span className={styles.cardHeader}>
                <span className={styles.cardTitle}>{record.title}</span>
                {record.status ? <span className={styles.cardStatus}>{record.status}</span> : null}
              </span>
              {record.value ? <span className={styles.cardValue}>{record.value}</span> : null}
              {record.meta ? <span className={styles.cardMeta}>{record.meta}</span> : null}
            </span>
            <ChevronRight aria-hidden size={18} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {content}
      <FloatingSheet
        dismissible
        maxHeight={720}
        minHeight={320}
        mode="overlay"
        open={selectedRecord !== undefined}
        restingHeight={480}
        snapPoints={[480, 720]}
        title={sheetTitle}
        variant="elevated"
        headerActions={
          <ActionIcon
            aria-label={t('mobile.records.close')}
            icon={X}
            onClick={() => handleOpenChange(false)}
          />
        }
        onOpenChange={handleOpenChange}
      >
        <dl aria-label={t('mobile.records.details')} className={styles.details}>
          {selectedRecord?.fields.map((field, index) => (
            <div className={styles.field} key={index}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </FloatingSheet>
    </>
  );
};

export default BusinessMobileRecordList;
