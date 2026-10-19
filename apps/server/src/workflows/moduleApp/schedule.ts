type CronField = { values: Set<number>; wildcard: boolean };

const invalid = (): never => {
  throw new Error('MODULE_APP_SCHEDULE_INVALID');
};

const parseNumber = (value: string, min: number, max: number) => {
  if (!/^\d+$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) invalid();
  return parsed;
};

const parseField = (expression: string, min: number, max: number): CronField => {
  if (!expression || expression.length > 120) invalid();
  const values = new Set<number>();
  const tokens = expression.split(',');
  if (tokens.length > max - min + 1) invalid();
  for (const token of tokens) {
    const [base, stepText, ...rest] = token.split('/');
    if (rest.length > 0) invalid();
    const step = stepText === undefined ? 1 : parseNumber(stepText, 1, max - min + 1);
    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else if (base.includes('-')) {
      const range = base.split('-');
      if (range.length !== 2) invalid();
      start = parseNumber(range[0], min, max);
      end = parseNumber(range[1], min, max);
      if (start > end) invalid();
    } else {
      start = parseNumber(base, min, max);
      end = start;
      if (stepText !== undefined) invalid();
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, wildcard: expression === '*' };
};

export const parseModuleAppSchedule = (schedule: string) => {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5 || schedule.length > 320) invalid();
  return {
    day: parseField(fields[2], 1, 31),
    hour: parseField(fields[1], 0, 23),
    minute: parseField(fields[0], 0, 59),
    month: parseField(fields[3], 1, 12),
    weekday: parseField(fields[4], 0, 6),
  };
};

const weekdayMap: Record<string, number> = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3,
};

export const getNextModuleAppScheduleTime = (input: {
  after: Date;
  schedule: string;
  timezone: string;
}) => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
      minute: 'numeric',
      month: 'numeric',
      timeZone: input.timezone,
      weekday: 'short',
    });
  } catch {
    throw new Error('MODULE_APP_SCHEDULE_TIMEZONE_INVALID');
  }
  const cron = parseModuleAppSchedule(input.schedule);
  const start = new Date(input.after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const maxMinutes = 366 * 24 * 60;
  for (let offset = 0; offset < maxMinutes; offset++) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    const day = Number(parts.day);
    const weekday = weekdayMap[parts.weekday];
    const dayMatches = cron.day.values.has(day);
    const weekdayMatches = cron.weekday.values.has(weekday);
    const calendarMatches =
      cron.day.wildcard && cron.weekday.wildcard
        ? true
        : cron.day.wildcard
          ? weekdayMatches
          : cron.weekday.wildcard
            ? dayMatches
            : dayMatches || weekdayMatches;
    if (
      cron.minute.values.has(Number(parts.minute)) &&
      cron.hour.values.has(Number(parts.hour)) &&
      cron.month.values.has(Number(parts.month)) &&
      calendarMatches
    ) {
      return candidate;
    }
  }
  throw new Error('MODULE_APP_SCHEDULE_NEXT_RUN_NOT_FOUND');
};
