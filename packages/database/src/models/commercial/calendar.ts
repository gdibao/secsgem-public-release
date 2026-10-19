export const addCalendarMonths = (date: Date, months: number) => {
  const next = new Date(date);
  const originalDay = next.getUTCDate();

  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return next;
};

export const addCalendarYears = (date: Date, years: number) => addCalendarMonths(date, years * 12);
