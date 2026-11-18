import { z } from "zod";
import { DayOfWeek, Difficulty, TrainingLocation } from "@prisma/client";

export const ExerciseSchema = z.object({
    name: z.string().min(2).max(100),
    description: z.string().max(500).default(""),
    category: z.string().max(40).default("Strength"),
    duration: z.number().positive().int().default(10),
    bodyPart: z.string().max(30),
    target: z.string().max(40).optional(),
    secondaryMuscles: z.array(z.string().max(40)).default([]),
    equipment: z.string().max(40).default("Bodyweight"),
    instructions: z.array(z.string().max(200)).min(1),
    difficulty: z.enum(Difficulty).default(Difficulty.BEGINNER),
    videoUrl: z.string().optional(),
    trainingLocation: z.enum(TrainingLocation).default(TrainingLocation.GYM),
});

export type ExerciseInput = z.infer<typeof ExerciseSchema>;

export const AddWorkoutItemSchema = z.object({
    // Apps send null when there is no plan for today yet.
    userWorkoutId: z.string().uuid().nullish(),
    dayOfWeek: z.enum(DayOfWeek),
    workoutId: z.string().uuid().optional(),
    customExercise: z.object({
        name: z.string().min(2).max(100),
        description: z.string().max(500).optional(),
        category: z.string().max(40).default("Strength"),
        bodyPart: z.string().max(30),
        target: z.string().max(40).optional(),
        secondaryMuscles: z.array(z.string().max(40)).default([]),
        equipment: z.string().max(40).default("Bodyweight"),
        instructions: z.array(z.string().max(200)).default([]),
        difficulty: z.enum(Difficulty).default(Difficulty.BEGINNER),
        videoUrl: z.string().optional(),
        trainingLocation: z.enum(TrainingLocation).default(TrainingLocation.GYM),
    }).optional(),
    targetSets: z.number().int().positive().default(3),
    targetReps: z.string().default("8-10"),
    targetWeight: z.number().nonnegative().optional(),
    targetRpe: z.number().min(1).max(10).optional(),
    restSeconds: z.number().int().nonnegative().default(90),
});

export type AddWorkoutItemInput = z.infer<typeof AddWorkoutItemSchema>;

export const UpdateWorkoutItemSchema = z.object({
    // Reopen a checklist item without altering any logged workout sets.
    status: z.literal("NOT_STARTED").optional(),
    targetSets: z.number().int().positive().optional(),
    targetReps: z.string().optional(),
    targetWeight: z.number().nonnegative().optional(),
    targetRpe: z.number().min(1).max(10).optional(),
    restSeconds: z.number().int().nonnegative().optional(),
});

export type UpdateWorkoutItemInput = z.infer<typeof UpdateWorkoutItemSchema>;

export const LogSetSchema = z.object({
    userWorkoutItemId: z.string().uuid(),
    setNumber: z.number().int().min(1).max(100),
    reps: z.number().int().min(1).max(1000),
    weight: z.number().min(0).max(1000).optional(),
    rpe: z.number().min(1).max(10).optional(),
    day: z.string().regex(/^\d{1,2}$/),
    month: z.string().regex(/^\d{1,2}$/),
    year: z.string().regex(/^\d{4}$/),
}).refine(value => {
    const date = `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}, 'Invalid set date');
