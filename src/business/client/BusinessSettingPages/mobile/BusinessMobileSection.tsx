'use client';

import { FormGroup } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    min-width: 0;
    padding-block: 4px 16px;
  `,
  icon: css`
    flex: none;
    transition: transform ${cssVar.motionDurationMid};
  `,
  iconOpen: css`
    transform: rotate(180deg);
  `,
  label: css`
    min-width: 0;
  `,
  section: css`
    min-width: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  summary: css`
    margin-block-start: 2px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
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
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  trigger: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;

    width: 100%;
    min-height: 44px;
    padding: 8px 0;
    border: 0;

    font: inherit;
    text-align: start;

    appearance: none;
    background: transparent;
  `,
}));

export interface BusinessSettingsSectionProps {
  children: ReactNode;
  defaultOpen?: boolean;
  desktopExtra?: ReactNode;
  mobile?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  summary?: ReactNode;
  title: ReactNode;
}

export const BusinessMobileSection = ({
  children,
  defaultOpen = true,
  onOpenChange,
  open: controlledOpen,
  summary,
  title,
}: Omit<BusinessSettingsSectionProps, 'desktopExtra' | 'mobile'>) => {
  const { t } = useTranslation('subscription');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();
  const actionLabelId = `${id}-action-label`;
  const triggerId = `${id}-trigger`;
  const titleId = `${id}-title`;
  const panelId = `${id}-panel`;
  const actionLabel = t(open ? 'mobile.section.collapse' : 'mobile.section.expand', {
    title: '',
  }).trim();
  const toggleOpen = () => {
    const nextOpen = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <section className={styles.section}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-labelledby={`${actionLabelId} ${titleId}`}
        className={styles.trigger}
        id={triggerId}
        type="button"
        onClick={toggleOpen}
      >
        <span className={styles.label}>
          <span className={styles.visuallyHidden} id={actionLabelId}>
            {actionLabel}
          </span>
          <span className={styles.title} id={titleId}>
            {title}
          </span>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cx(styles.icon, open && styles.iconOpen)} size={18} />
      </button>
      {open ? (
        <div aria-labelledby={triggerId} className={styles.content} id={panelId} role="region">
          {children}
        </div>
      ) : null}
    </section>
  );
};

export const BusinessSettingsSection = ({
  children,
  defaultOpen = true,
  desktopExtra,
  mobile,
  onOpenChange,
  open,
  summary,
  title,
}: BusinessSettingsSectionProps) => {
  if (mobile) {
    return (
      <BusinessMobileSection
        defaultOpen={defaultOpen}
        open={open}
        summary={summary}
        title={title}
        onOpenChange={onOpenChange}
      >
        {children}
      </BusinessMobileSection>
    );
  }

  return (
    <FormGroup collapsible={false} extra={desktopExtra} gap={16} title={title} variant="filled">
      {children}
    </FormGroup>
  );
};
