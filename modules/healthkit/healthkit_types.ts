import { z } from "zod";
import { isPreviewSource } from "../../utils/real_data";
import { calendarDate } from '../progress/progress_types';

export const HealthKitWorkoutSchema = z.object({
    externalId: z.string().min(1).max(500),
    workoutType: z.string().min(1),
    durationMinutes: z.number().positive(),
    activeCalories: z.number().nonnegative().nullable().optional(),
    totalDistance: z.number().nonnegative().optional(),
    avgHeartRate: z.number().positive().optional(),
    maxHeartRate: z.number().positive().optional(),
    avgWatts: z.number().nonnegative().optional(),
    elevationAscent: z.number().nonnegative().optional(),
    hrZone1Minutes: z.number().nonnegative().optional(),
    hrZone2Minutes: z.number().nonnegative().optional(),
    hrZone3Minutes: z.number().nonnegative().optional(),
    hrZone4Minutes: z.number().nonnegative().optional(),
    hrZone5Minutes: z.number().nonnegative().optional(),
    source: z.string().min(1),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
}).refine(workout => workout.endedAt > workout.startedAt, 'Workout end must follow its start.');

export const HealthkitInputSchema = z.object({
    date: calendarDate,
    sourceProvider: z.string().refine(value => !isPreviewSource(value), 'Preview readings are not accepted.').optional(),
    sleepTotalMinutes: z.number().nonnegative().optional(),
    sleepDeepMinutes: z.number().nonnegative().optional(),
    sleepRemMinutes: z.number().nonnegative().optional(),
    sleepCoreMinutes: z.number().nonnegative().optional(),
    sleepEfficiency: z.number().min(0).max(100).optional(),
    hrv: z.number().positive().optional(),
    hrvMethod: z.enum(['RMSSD', 'SDNN']).optional(),
    utcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
    metricMetadata: z.record(z.string(), z.object({
      source: z.string().max(200),
      measuredAt: z.string().datetime(),
      method: z.string().max(50).optional(),
    })).optional(),
    restingHR: z.number().positive().optional(),
    avgDayHR: z.number().positive().optional(),
    activeCalories: z.number().nonnegative().optional(),
    basalCalories: z.number().nonnegative().optional(),
    steps: z.number().int().nonnegative().optional(),
    flightsClimbed: z.number().int().nonnegative().optional(),
    weight: z.number().positive().optional(),
    bodyFatPct: z.number().min(0).max(100).optional(),
    leanMassKg: z.number().positive().optional(),
    vo2Max: z.number().positive().optional(),
    bloodOxygen: z.number().min(0).max(100).optional(),
    respiratoryRate: z.number().positive().optional(),
    wristTempDeviation: z.number().optional(),
    bloodGlucoseAvg: z.number().positive().optional(),
    cardioRecoveryHr: z.number().positive().optional(),
    cyclePhase: z.enum(["MENSTRUAL", "FOLLICULAR", "OVULATORY", "LUTEAL"]).optional(),
    healthAge: z.number().positive().optional(),
    externalWorkouts: z.array(HealthKitWorkoutSchema).optional(),
});

export const SnapshotQuerySchema = z.object({
    date: calendarDate.optional(),
});

export const TrendQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
});

export const WorkoutQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
});

export type HealthKitWorkoutInput = z.infer<typeof HealthKitWorkoutSchema>;
export type HealthkitInput = z.infer<typeof HealthkitInputSchema>;
export type SnapshotQueryInput = z.infer<typeof SnapshotQuerySchema>;
export type TrendQueryInput = z.infer<typeof TrendQuerySchema>;
export type WorkoutQueryInput = z.infer<typeof WorkoutQuerySchema>;
