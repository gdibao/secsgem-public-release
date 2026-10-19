'use client';

import { Flexbox, InputNumber } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { Alert } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { commercialService } from '@/services/commercial';
import { AUTO_TOP_UP_AVAILABLE, type AutoTopUpSetting } from '@/types/business';

import { subscriptionPageStyles, toDisplayCredits, toRawCredits } from './shared';

const styles = createStaticStyles(({ css }) => ({
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
}));

interface AutoTopUpSettingsProps {
  isPaidPlan: boolean;
}

const AutoTopUpSettings = memo<AutoTopUpSettingsProps>(({ isPaidPlan }) => {
  const { t } = useTranslation('subscription');
  const { data, error, isLoading, mutate } = useClientDataSWR(['business-auto-topup-setting'], () =>
    commercialService.getAutoTopUpSetting(),
  );
  const [draft, setDraft] = useState<AutoTopUpSetting>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (isLoading && !draft) {
    return <div className={subscriptionPageStyles.caption}>正在加载自动充值设置...</div>;
  }

  if (!draft) {
    return (
      <Flexbox gap={12}>
        <Alert showIcon title={t('credits.autoTopUp.loadError')} type="error" />
        <Button onClick={() => void mutate()}>{t('credits.autoTopUp.retry')}</Button>
      </Flexbox>
    );
  }

  const updateCreditValue = (
    key: 'monthlyLimit' | 'targetBalance' | 'threshold',
    value: null | number | string,
  ) => {
    const numericValue = Number(value ?? 0);
    setSaved(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            [key]:
              value === null && key === 'monthlyLimit'
                ? null
                : toRawCredits(Number.isFinite(numericValue) ? numericValue : 0),
          }
        : current,
    );
  };

  const submit = async () => {
    if (!draft) return;
    if (draft.targetBalance <= draft.threshold) {
      setSaveError(t('credits.autoTopUp.validation.targetMustExceedThreshold'));
      return;
    }

    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const result = await commercialService.updateAutoTopUpSetting({
        enabled: draft.enabled,
        monthlyLimit: draft.monthlyLimit,
        targetBalance: draft.targetBalance,
        threshold: draft.threshold,
      });
      setDraft(result);
      setSaved(true);
      await mutate();
    } catch {
      setSaveError(t('credits.autoTopUp.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {!AUTO_TOP_UP_AVAILABLE ? (
        <Alert showIcon title={t('credits.autoTopUp.unavailable')} type="info" />
      ) : null}
      {!isPaidPlan ? (
        <Alert showIcon title={t('credits.autoTopUp.upgradeHint')} type="info" />
      ) : null}
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <div>
          <div>{t('credits.autoTopUp.toggle')}</div>
          <div className={subscriptionPageStyles.caption}>{t('credits.autoTopUp.desc')}</div>
        </div>
        <Switch
          checked={AUTO_TOP_UP_AVAILABLE && draft.enabled}
          disabled={!AUTO_TOP_UP_AVAILABLE || !isPaidPlan}
          onChange={(enabled) => {
            setSaved(false);
            setDraft((current) => (current ? { ...current, enabled } : current));
          }}
        />
      </Flexbox>
      {error ? (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Alert showIcon title={t('credits.autoTopUp.loadError')} type="error" />
          <Button onClick={() => void mutate()}>{t('credits.autoTopUp.retry')}</Button>
        </Flexbox>
      ) : null}
      {saveError ? <Alert showIcon title={saveError} type="error" /> : null}
      {saved ? <Alert showIcon title={t('credits.autoTopUp.saveSuccess')} type="success" /> : null}
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>{t('credits.autoTopUp.threshold')}</span>
          <InputNumber
            disabled={!AUTO_TOP_UP_AVAILABLE || !isPaidPlan}
            min={0}
            precision={2}
            suffix={'M'}
            value={toDisplayCredits(draft.threshold)}
            onChange={(value) => updateCreditValue('threshold', value)}
          />
        </label>
        <label className={styles.field}>
          <span>{t('credits.autoTopUp.targetBalance')}</span>
          <InputNumber
            disabled={!AUTO_TOP_UP_AVAILABLE || !isPaidPlan}
            min={0}
            precision={2}
            suffix={'M'}
            value={toDisplayCredits(draft.targetBalance)}
            onChange={(value) => updateCreditValue('targetBalance', value)}
          />
        </label>
        <label className={styles.field}>
          <span>{t('credits.autoTopUp.monthlyLimit')}</span>
          <InputNumber
            disabled={!AUTO_TOP_UP_AVAILABLE || !isPaidPlan}
            min={0}
            placeholder={t('credits.autoTopUp.monthlyLimitPlaceholder')}
            precision={2}
            suffix={'M'}
            value={
              draft.monthlyLimit === null || draft.monthlyLimit === undefined
                ? null
                : toDisplayCredits(draft.monthlyLimit)
            }
            onChange={(value) => updateCreditValue('monthlyLimit', value)}
          />
        </label>
      </div>
      <Button
        disabled={!AUTO_TOP_UP_AVAILABLE || !isPaidPlan}
        loading={saving}
        type="primary"
        onClick={() => void submit()}
      >
        {t('credits.autoTopUp.save')}
      </Button>
    </Flexbox>
  );
});

AutoTopUpSettings.displayName = 'AutoTopUpSettings';
export default AutoTopUpSettings;
