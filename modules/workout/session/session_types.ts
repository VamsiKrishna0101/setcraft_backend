import { z } from 'zod';

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export const dayQuery = z.object({
  date: dateSchema,
  utcOffsetMinutes: z.coerce.number().int().min(-720).max(840).default(0),
});

const setTargetsSchema = z.object({
  weightBasis: z.enum(['as_logged', 'bodyweight', 'establish_starting_load', 'estimated_start']),
  weightUnit: z.enum(['per_hand', 'total_load', 'as_logged', 'bodyweight']).optional(),
  sets: z.array(z.object({
    setNumber: z.number().int().min(1).max(30),
    repsMin: z.number().int().min(1).max(1000),
    repsMax: z.number().int().min(1).max(1000),
    weightKg: z.number().min(0).max(1000).nullable(),
    targetRpe: z.number().min(1).max(10).optional(),
  }).refine(set => set.repsMin <= set.repsMax, 'Invalid rep target.')).min(1).max(30)
    .refine(sets => sets.every((set, index) => set.setNumber === index + 1), 'Keep set numbers in order.'),
});

export const targetsSchema = z.object({
  workoutId: z.string().uuid(),
  targetSets: z.number().int().min(1).max(30).default(3),
  targetReps: z.string().trim().min(1).max(24).default('8-12'),
  targetWeight: z.number().min(0).max(1000).default(0),
  restSeconds: z.number().int().min(0).max(1800).default(90),
  setTargets: setTargetsSchema.optional(),
});

export const daySettingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  restDay: z.boolean().optional(),
});
export const reorderSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(100) });
export const routineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(targetsSchema).min(1).max(100),
}).refine(routine => routine.items.every(item =>
  !item.setTargets || item.setTargets.sets.length === item.targetSets),
  'Keep the number of prescribed sets consistent with the targets.');
export const setSchema = z.object({
  setNumber: z.number().int().min(1).max(100),
  reps: z.number().int().min(1).max(1000),
  weight: z.number().min(0).max(1000).nullable().default(null),
  rpe: z.number().min(1).max(10).nullable().default(null),
});
export const itemStatusSchema = z.object({ status: z.enum(['NOT_STARTED', 'COMPLETED', 'SKIPPED']) });
export const completeItemSchema = z.object({
  sets: z.array(setSchema).max(100).default([]).refine(
    sets => new Set(sets.map(set => set.setNumber)).size === sets.length,
    'Include each set number once.',
  ),
});
export type Targets = z.infer<typeof targetsSchema>;

export function weekday(date: string) {
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][
    new Date(`${date}T12:00:00Z`).getUTCDay()
  ]!;
}

export function weekDates(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(day);
    value.setUTCDate(value.getUTCDate() + index);
    return value.toISOString().slice(0, 10);
  });
}
