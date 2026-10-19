// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getNextModuleAppScheduleTime, parseModuleAppSchedule } from './schedule';

describe('module app schedules', () => {
  it('accepts bounded five-field cron and computes the next run server-side', () => {
    expect(parseModuleAppSchedule('*/15 * * * *')).toBeDefined();
    expect(
      getNextModuleAppScheduleTime({
        after: new Date('2026-07-11T00:07:00.000Z'),
        schedule: '*/15 * * * *',
        timezone: 'UTC',
      }),
    ).toEqual(new Date('2026-07-11T00:15:00.000Z'));
  });

  it('rejects seconds, out-of-range fields, and unknown timezones', () => {
    expect(() => parseModuleAppSchedule('* * * * * *')).toThrow('MODULE_APP_SCHEDULE_INVALID');
    expect(() => parseModuleAppSchedule('60 * * * *')).toThrow('MODULE_APP_SCHEDULE_INVALID');
    expect(() =>
      getNextModuleAppScheduleTime({
        after: new Date('2026-07-11T00:00:00.000Z'),
        schedule: '* * * * *',
        timezone: 'Not/A_Timezone',
      }),
    ).toThrow('MODULE_APP_SCHEDULE_TIMEZONE_INVALID');
  });
});
