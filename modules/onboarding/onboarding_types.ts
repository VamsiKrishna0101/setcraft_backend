import { z } from "zod";
import { MUSCLE_IDS } from "../heatmap/training_map_engine";
import { equipmentIdsSchema } from "./equipment_catalog";
import { APP_LANGUAGES } from "../../utils/app_locale";
import {
  WorkingToward,
  Gender,
  Experience,
  DaysPerWeek,
  WorkoutDuration,
  TrainingLocation,
  Equipment,
  ActivityLevel,
  SleepDuration,
  EatingStyle,
  WeeklyFoodBudget,
  BodyLimitation,
  Onboarding,
} from "@prisma/client";

export const createOnboardingSchema = z.object({
  workingToward: z.enum(WorkingToward),
  language: z.enum(APP_LANGUAGES).default("en"),
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must not exceed 50 characters"),
  age: z
    .number()
    .int()
    .min(13, "Must be at least 13 years old")
    .max(100, "Age must be 100 or less"),
  gender: z.enum(Gender),
  height: z.number().positive("Height must be a positive number").nullish(),
  weight: z.number().positive("Weight must be a positive number").nullish(),
  targetWeight: z
    .number()
    .positive("Target weight must be a positive number")
    .optional(),
  experience: z.enum(Experience),
  daysPerWeek: z.enum(DaysPerWeek),
  workoutDuration: z.enum(WorkoutDuration),
  trainingLocation: z.enum(TrainingLocation),
  equipment: z
    .array(z.enum(Equipment))
    .min(1, "Select at least one equipment option"),
  equipmentIds: equipmentIdsSchema.optional(),
  activityLevel: z.enum(ActivityLevel),
  sleepDuration: z.enum(SleepDuration),
  eatingStyle: z.enum(EatingStyle),
  customEatingStyle: z.string().trim().max(80).nullable().optional(),
  weeklyFoodBudget: z.enum(WeeklyFoodBudget).nullable().optional(),
  limitations: z.array(z.enum(BodyLimitation)).default([BodyLimitation.NONE]),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  preferredTime: z
    .enum(["ANY", "MORNING", "AFTERNOON", "EVENING"])
    .nullable()
    .optional(),
  trainingDays: z
    .array(
      z.enum([
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ]),
    )
    .max(7)
    .refine((v) => new Set(v).size === v.length, "Training days must be unique")
    .optional(),
  trainingSplit: z
    .enum([
      "AUTO",
      "FULL_BODY",
      "UPPER_LOWER",
      "PUSH_PULL_LEGS",
      "MUSCLE_FOCUSED",
      "CUSTOM",
    ])
    .optional(),
  customTrainingSplit: z
    .partialRecord(
      z.enum([
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ]),
      z
        .array(
          z.enum([
            "chest",
            "back",
            "legs",
            "shoulders",
            "biceps",
            "triceps",
            "core",
          ]),
        )
        .min(1)
        .max(7)
        .refine(
          (values) => new Set(values).size === values.length,
          "Muscles must be unique",
        ),
    )
    .optional(),
  focusMuscles: z
    .array(z.enum(MUSCLE_IDS))
    .max(MUSCLE_IDS.length)
    .refine(
      (v) => new Set(v).size === v.length,
      "Training priorities must be unique",
    )
    .optional(),
  customLimitations: z.string().trim().max(500).nullable().optional(),
  foodAllergies: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  dislikedFoods: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  foodBudgetAmount: z.number().positive().max(100000).nullable().optional(),
  foodBudgetCurrency: z
    .enum(["GBP", "EUR", "CHF", "SEK", "NOK", "DKK", "USD", "INR"])
    .nullable()
    .optional(),
});

// Zod preserves defaults through partial(); a preferences-only PATCH must not
// reset an existing member's language or limitations.
export const updateOnboardingSchema = createOnboardingSchema.partial().extend({
  language: createOnboardingSchema.shape.language.removeDefault().optional(),
  limitations: createOnboardingSchema.shape.limitations
    .removeDefault()
    .optional(),
});

export type OnboardingInput = z.infer<typeof createOnboardingSchema>;
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
export type OnboardingResponse = Onboarding;

export {
  WorkingToward,
  Gender,
  Experience,
  DaysPerWeek,
  WorkoutDuration,
  TrainingLocation,
  Equipment,
  ActivityLevel,
  SleepDuration,
  EatingStyle,
  WeeklyFoodBudget,
  BodyLimitation,
};
