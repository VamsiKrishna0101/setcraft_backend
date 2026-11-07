import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const notificationPreferences = z
  .object({
    enabled: z.boolean(),
    workouts: z.boolean(),
    plans: z.boolean(),
    checkIns: z.boolean(),
    summaries: z.boolean(),
    meals: z.boolean(),
    billing: z.boolean(),
    pausedUntil: z.string().datetime({ offset: true }).nullable(),
    workoutTime: time,
    checkInTime: time,
    summaryTime: time,
    mealTime: time,
    mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']),
    quietStart: time,
    quietEnd: time,
    timezone: z
      .string()
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid timezone.'),
  })
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export const notificationDevice = z
  .object({
    installationId: z.string().regex(/^[a-zA-Z0-9_-]{20,80}$/),
    token: z.string().min(40).max(4096),
    platform: z.enum(['android', 'ios']),
    foreground: z.boolean().default(false),
  })
  .strict();

export function localTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const value = (name: string) => parts.find((part) => part.type === name)!.value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;

  return {
    date,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}

export function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function quietHours(current: number, start: string, end: string) {
  const first = minutes(start);
  const last = minutes(end);
  if (first === last) return false;
  return first < last ? current >= first && current < last : current >= first || current < last;
}

export function reminderDue(current: number, time: string) {
  const start = minutes(time);
  return current >= start && current < Math.min(start + 60, 1440);
}

// A reminder inside quiet time moves to the end of that same quiet period.
// A late-night reminder can therefore belong to the following local day.
export function effectiveReminder(time: string, start: string, end: string) {
  const value = minutes(time);
  if (!quietHours(value, start, end)) return { time, dayOffset: 0 };
  return { time: end, dayOffset: minutes(end) <= value ? 1 : 0 };
}

export const notificationCategories = {
  WORKOUT: 'workouts', CHECK_IN: 'checkIns', MEAL: 'meals', SUMMARY: 'summaries',
  PLAN_READY: 'plans', PLAN_AVAILABLE: 'plans', TRIAL_ENDING: 'billing',
  TRIAL_EXPIRED: 'billing', TEST: null,
} as const;
export type NotificationType = keyof typeof notificationCategories;

export function notificationPriority(type: string) {
  if (type === 'TEST') return 110;
  if (type === 'TRIAL_ENDING' || type === 'TRIAL_EXPIRED') return 100;
  if (type === 'WORKOUT') return 90;
  if (type === 'SUMMARY') return 80;
  if (type === 'PLAN_READY') return 70;
  if (type === 'PLAN_AVAILABLE') return 60;
  return 40;
}

export function notificationCategory(type: string) {
  return notificationCategories[type as NotificationType];
}

export function previousDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
