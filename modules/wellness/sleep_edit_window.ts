export const pastSleepReadOnly = 'Sleep entries from previous weeks are read-only.';
export const futureSleepReadOnly = 'Sleep can only be edited for today or earlier this week.';

/** The app's Monday–Sunday week, calculated from the device's current UTC offset. */
export function sleepEditError(date: string, utcOffsetMinutes = 0, now = new Date()): string | null {
  const today = new Date(now.getTime() + utcOffsetMinutes * 60000).toISOString().slice(0, 10);
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  if (date > today) return futureSleepReadOnly;
  if (date < monday.toISOString().slice(0, 10)) return pastSleepReadOnly;
  return null;
}
