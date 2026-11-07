import { z } from 'zod';
import { MUSCLE_IDS } from '../heatmap/training_map_engine';

export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export const rangeQuery = z.object({
  period: z.enum(['4w', '3m', '1y', 'all', 'custom']).default('4w'),
  date: calendarDate,
  start: calendarDate.optional(),
  end: calendarDate.optional(),
  dates: z.string().max(5000).refine(value => {
    const days = value.split(',');
    return days.length <= 366 && days.every(day => calendarDate.safeParse(day).success);
  }, 'Choose valid calendar days').optional(),
  dataset: z.enum(['real', 'preview']).refine((value): boolean => value === 'real', 'Preview data is unavailable').optional(),
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

export const listQuery = rangeQuery.extend({
  cursor: z.string().max(100).optional(),
  search: z.string().trim().max(100).default(''),
  muscle: z.enum(MUSCLE_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
}).superRefine((query, ctx) => {
  if (query.dates && (query.period !== 'custom' || query.dates.split(',').some(day =>
    day > query.date || !query.start || !query.end || day < query.start || day > query.end))) {
    ctx.addIssue({ code: 'custom', path: ['dates'], message: 'Selected days must be inside the date range' });
  }
  if (query.period !== 'custom') return;
  if (!query.start || !query.end || query.start > query.end || query.end > query.date || query.start < '2000-01-01') {
    ctx.addIssue({ code: 'custom', path: ['start'], message: 'Choose a valid past date range' });
  }
});

export type RangeQuery = z.infer<typeof rangeQuery>;
export type ListQuery = z.infer<typeof listQuery>;
export type Point = { date: string; value: number; source?: string; low?: number; high?: number };

export class ProgressError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
