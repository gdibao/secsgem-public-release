'use client';

import { type ScheduleType } from '@lobechat/utils/cron';
import { Flexbox, FormGroup } from '@lobehub/ui';
import { Checkbox, InputNumber, Select, TimePicker } from 'antd';
import { type Dayjs } from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SCHEDULE_TYPE_OPTIONS, TIMEZONE_OPTIONS, WEEKDAY_OPTIONS } from '../CronConfig';

export interface CronJobScheduleUpdate {
  hourlyInterval?: number;
  maxExecutions?: number | null;
  scheduleType?: ScheduleType;
  timezone?: string;
  triggerTime?: Dayjs;
  weekdays?: number[];
}

interface CronJobScheduleConfigProps {
  hourlyInterval?: number;
  maxExecutions?: number | null;
  onScheduleChange: (updates: CronJobScheduleUpdate) => void;
  scheduleType: ScheduleType;
  timezone: string;
  triggerTime: Dayjs;
  weekdays: number[];
}

const HOURLY_INTERVAL_OPTIONS = [1, 2, 6, 12].map((value) => ({
  label: `Every ${value} hour${value === 1 ? '' : 's'}`,
  value,
}));

const getScheduleTypeOptions = (t: (key: any) => string) =>
  SCHEDULE_TYPE_OPTIONS.map((item) => ({
    label: t(item.label),
    value: item.value,
  }));

const getWeekdayOptions = (t: (key: any) => string) =>
  WEEKDAY_OPTIONS.map((item) => ({
    label: t(item.label),
    value: item.value,
  }));

const CronJobScheduleConfig = memo<CronJobScheduleConfigProps>(
  ({
    hourlyInterval,
    maxExecutions,
    onScheduleChange,
    scheduleType,
    timezone,
    triggerTime,
    weekdays,
  }) => {
    const { t } = useTranslation('setting');
    const scheduleTypeOptions = getScheduleTypeOptions(t);
    const weekdayOptions = getWeekdayOptions(t);

    return (
      <FormGroup title={t('agentCronJobs.schedule')} variant="filled">
        <Flexbox gap={16}>
          <Flexbox gap={8}>
            <div>{t('agentCronJobs.form.frequency')}</div>
            <Select
              options={scheduleTypeOptions}
              value={scheduleType}
              onChange={(value) => onScheduleChange({ scheduleType: value })}
            />
          </Flexbox>

          {scheduleType === 'hourly' ? (
            <Flexbox gap={8}>
              <div>{t('agentCronJobs.form.every')}</div>
              <Select
                options={HOURLY_INTERVAL_OPTIONS}
                value={hourlyInterval ?? 1}
                onChange={(value) => onScheduleChange({ hourlyInterval: value })}
              />
            </Flexbox>
          ) : (
            <Flexbox gap={8}>
              <div>{t('agentCronJobs.form.time')}</div>
              <TimePicker
                format="HH:mm"
                value={triggerTime}
                onChange={(value) => value && onScheduleChange({ triggerTime: value })}
              />
            </Flexbox>
          )}

          {scheduleType === 'weekly' && (
            <Flexbox gap={8}>
              <div>{t('agentCronJobs.weekdays')}</div>
              <Checkbox.Group
                options={weekdayOptions}
                value={weekdays}
                onChange={(values) => onScheduleChange({ weekdays: values.map(Number) })}
              />
            </Flexbox>
          )}

          <Flexbox gap={8}>
            <div>{t('agentCronJobs.form.timezone')}</div>
            <Select
              showSearch
              options={TIMEZONE_OPTIONS}
              value={timezone}
              onChange={(value) => onScheduleChange({ timezone: value })}
            />
          </Flexbox>

          <Flexbox gap={8}>
            <div>{t('agentCronJobs.form.maxExecutions')}</div>
            <InputNumber
              min={1}
              placeholder={t('agentCronJobs.form.maxExecutions.placeholder')}
              value={maxExecutions ?? null}
              onChange={(value) => onScheduleChange({ maxExecutions: value ?? null })}
            />
          </Flexbox>
        </Flexbox>
      </FormGroup>
    );
  },
);

export default CronJobScheduleConfig;
