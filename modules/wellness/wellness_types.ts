import { z } from 'zod';
import { calendarDate } from '../progress/progress_types';

export const wellnessDate = calendarDate;
export const wearableInput = z.object({ usage: z.enum(['UNKNOWN', 'WEARABLE', 'NONE']) }).strict();
export const wellnessInput = z.object({
  sleepMinutes: z.number().int().min(0).max(1440),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  rested: z.number().int().min(1).max(5).nullable().default(null),
  soreness: z.number().int().min(1).max(5).nullable().default(null),
  source: z.enum(['self_report', 'phone_estimate_confirmed']).default('self_report'),
  sleepStartedAt: z.iso.datetime().nullable().default(null),
  sleepEndedAt: z.iso.datetime().nullable().default(null),
  utcOffsetMinutes: z.number().int().min(-840).max(840).default(0),
}).strict();
