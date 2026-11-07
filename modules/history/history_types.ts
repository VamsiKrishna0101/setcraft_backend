import { z } from "zod";
import { calendarDate } from '../progress/progress_types';

export const StrengthHistoryQuerySchema = z.object({
    workoutId: z.string().uuid("Invalid workoutId"),
    days: z.coerce.number().int().min(7).max(365).default(90),
});

export const NutritionHistoryQuerySchema = z.object({
    days: z.coerce.number().int().min(7).max(365).default(30),
});

export const RecoveryHistoryQuerySchema = z.object({
    days: z.coerce.number().int().min(7).max(365).default(30),
    date: calendarDate.optional(),
});

export const BodyHistoryQuerySchema = z.object({
    days: z.coerce.number().int().min(7).max(365).default(90),
});

export const WorkoutCompletionQuerySchema = z.object({
    weeks: z.coerce.number().int().min(1).max(52).default(8),
});

export const VolumeHistoryQuerySchema = z.object({
    weeks: z.coerce.number().int().min(1).max(52).default(8),
});

export type StrengthHistoryQuery = z.infer<typeof StrengthHistoryQuerySchema>;
export type NutritionHistoryQuery = z.infer<typeof NutritionHistoryQuerySchema>;
export type RecoveryHistoryQuery = z.infer<typeof RecoveryHistoryQuerySchema>;
export type BodyHistoryQuery = z.infer<typeof BodyHistoryQuerySchema>;
export type WorkoutCompletionQuery = z.infer<typeof WorkoutCompletionQuerySchema>;
export type VolumeHistoryQuery = z.infer<typeof VolumeHistoryQuerySchema>;
