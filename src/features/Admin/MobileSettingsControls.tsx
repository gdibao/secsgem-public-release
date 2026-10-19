'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { Alert } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_ICON_NAMES, type MobileIconName } from '@/const/mobileConfig';

import type { SelectOption, SelectorStatus } from './mobileSettingsHelpers';

const styles = createStaticStyles(({ css, cssVar }) => ({
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
  `,
  select: css`
    height: 32px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;
    background: ${cssVar.colorBgContainer};
    color: ${cssVar.colorText};
  `,
}));

export const LabeledField = ({ children, label }: { children: ReactNode; label: string }) => (
  <label className={styles.field}>
    <span>{label}</span>
    {children}
  </label>
);

export const IconSelect = ({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: MobileIconName) => void;
  value: string;
}) => {
  const { t } = useTranslation('subscription');

  return (
    <select
      aria-label={label}
      className={styles.select}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('admin.mobile.selectIcon', { defaultValue: 'Select icon' })}</option>
      {MOBILE_ICON_NAMES.map((icon) => (
        <option key={icon} value={icon}>
          {icon}
        </option>
      ))}
    </select>
  );
};

export const SelectField = ({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) => {
  const { t } = useTranslation('subscription');

  return (
    <select
      aria-label={label}
      className={styles.select}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('admin.mobile.select', { defaultValue: 'Select' })}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export const AccessibleSwitch = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) => {
  const id = useId();

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <Switch checked={checked} id={id} onChange={(nextChecked) => onChange(nextChecked)} />
    </div>
  );
};

export const OrderButtons = ({
  label,
  onMove,
  position,
  total,
}: {
  label: string;
  onMove: (direction: -1 | 1) => void;
  position: number;
  total: number;
}) => {
  const { t } = useTranslation('subscription');
  const up = t('admin.mobile.moveUp', { defaultValue: 'Move {{label}} up', label });
  const down = t('admin.mobile.moveDown', { defaultValue: 'Move {{label}} down', label });

  return (
    <Flexbox horizontal gap={4}>
      <Button
        aria-label={up}
        disabled={position === 0}
        icon={<ArrowUp size={14} />}
        title={up}
        onClick={() => onMove(-1)}
      />
      <Button
        aria-label={down}
        disabled={position === total - 1}
        icon={<ArrowDown size={14} />}
        title={down}
        onClick={() => onMove(1)}
      />
    </Flexbox>
  );
};

export const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }) => {
  const { t } = useTranslation('subscription');
  const removeLabel = t('admin.mobile.remove', { defaultValue: 'Remove {{label}}', label });

  return (
    <Button
      aria-label={removeLabel}
      icon={<Trash2 size={14} />}
      title={removeLabel}
      onClick={onClick}
    />
  );
};

export const SelectorAlert = ({
  label,
  onRetry,
  retryLabel,
  status,
}: {
  label: string;
  onRetry: () => void;
  retryLabel: string;
  status: SelectorStatus;
}) =>
  status.error ? (
    <Alert
      showIcon
      title={label}
      type="warning"
      action={
        <Button disabled={status.loading} size="small" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    />
  ) : null;
