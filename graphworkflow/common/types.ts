import { z } from "zod";
import { dateSchema } from "../../modules/workout/session/session_types";

export const PROMPT_VERSION = "weekly-v14-sharing-consent";

export const RULE_VERSION = "personal-trainer-2026-11-v10";

export const REGIONS = [
  "chest",
  "back",
  "legs",
  "shoulders",
  "biceps",
  "triceps",
  "core",
] as const;

export type Region = (typeof REGIONS)[number];

export type Pattern =
  | "push"
  | "pull"
  | "squat"
  | "hinge"
  | "calves"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "core";

export type Candidate = {
  id: string;
  name: string;
  displayName?: string;
  equipment: string;
  region: Region;
  pattern: Pattern;
  primary: string[];
  secondary: string[];
  compound: boolean;
  bodyweight: boolean;
  requiresBench: boolean;
  // Part of the region this exercise mainly hits, e.g. upper_chest, lats, rear_delts.
  subTarget: string;
  difficulty?: string | null;
  movementType?: string;
  technicalReason?: string;
  movementDemands?: string[];
};

export type LoggedSet = {
  id: string;
  exerciseId: string;
  workoutItemId?: string;
  date: string;
  set: number;
  reps: number;
  weight: number | null;
  rpe: number | null;
  synthetic: boolean;
  exerciseName?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  plannedRepsMin?: number | null;
  plannedRepsMax?: number | null;
  plannedSets?: number;
  weightUnit?: "per_hand" | "total_load" | "as_logged" | "bodyweight";
};

export type Food = {
  id: string;
  name: string;
  group: "protein" | "starch" | "fruit" | "vegetable" | "fat" | "breakfast";
  vegan: boolean;
  vegetarian?: boolean;
  allergens: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageUrl: string | null;
  source: string | null;
};

export type Profile = {
  nutritionMode?: "ROUTINE" | "AI" | "TRACK";
  mealSlots?: Array<"BREAKFAST" | "LUNCH" | "DINNER" | "SNACK">;
  age: number;
  gender: string;
  height: number | null;
  weight: number | null;
  targetWeight: number | null;
  goal: string;
  experience: string;
  daysPerWeek: number;
  minutes: number;
  trainingDays: string[];
  trainingSplit?:
    | "AUTO"
    | "FULL_BODY"
    | "UPPER_LOWER"
    | "PUSH_PULL_LEGS"
    | "MUSCLE_FOCUSED"
    | "CUSTOM";
  customTrainingSplit?: Partial<Record<string, Region[]>>;
  equipment: string[];
  equipmentIds: string[];
  location: string;
  limitations: string[];
  customLimitations: string | null;
  focusMuscles: string[];
  language: string;
  eatingStyle: string;
  activityLevel: string;
  sleepDuration?: string;
  preferredTime?: string | null;
  customEatingStyle?: string | null;
  weeklyFoodBudget?: string | null;
  allergies: string[];
  dislikes: string[];
  countryCode: string;
  budgetAmount: number | null;
  budgetCurrency: string | null;
};

export const programmeSchema = z
  .object({
    startedOn: dateSchema,
    goal: z.string(),
    experience: z.string(),
    environment: z.enum(["GYM", "HOME_EQUIPMENT", "HOME_BODYWEIGHT", "MIXED"]),
    phase: z.enum(["LEARN", "BUILD", "RETURN", "DEVELOP"]),
    lastTrainedOn: dateSchema.nullable().optional(),
    anchorExerciseIds: z.array(z.string().uuid()).max(30),
  })
  .strict();
export type Programme = z.infer<typeof programmeSchema>;

export type Snapshot = {
  version: 1;
  onboardingStarter?: boolean;
  selectedSchedule?: { startDate: string; trainingDates: string[] };
  userId: string;
  weekStart: string;
  timezone: string;
  cutoff: string;
  recoveryCutoff?: string;
  historyStart: string;
  synthetic: boolean;
  profile: Profile;
  candidates: Candidate[];
  foods: Food[];
  routineMeals?: Array<{
    routineId: string;
    date: string;
    mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
    entry: import("../../modules/nutrition/food_planning_service").MealEntry;
  }>;
  sets: LoggedSet[];
  sessions: Array<{
    date: string;
    status: string;
    durationSeconds: number | null;
    plannedSets: number;
    loggedSets: number;
  }>;
  wellness: Array<{
    date: string;
    sleepMinutes: number | null;
    energy: number | null;
    rested: number | null;
    soreness: number | null;
    source: string;
  }>;
  health: Array<{
    date: string;
    steps: number | null;
    sleepMinutes: number | null;
    hrv: number | null;
    restingHR: number | null;
    source: string | null;
  }>;
  meals: Array<{
    date: string;
    foodId?: string;
    name?: string;
    mealType?: string;
    servings?: number;
    grams?: number | null;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    synthetic: boolean;
  }>;
  water: Array<{ date: string; amountMl: number; synthetic: boolean }>;
  // Newest first: the latest saved body scan and the one before it.
  measurements: Array<{
    id: string;
    date: string;
    metrics: unknown;
    source: string;
    summary?: string | null;
    guidance?: unknown;
  }>;
  coverage: {
    loggedDays: number;
    weeksWithLogs: number;
    syntheticDays: number;
  };
  muscleCheckIns?: Array<{
    id: string;
    muscleId: string;
    date: string;
    soreness: number;
  }>;
  programmeMemory?: {
    planId: string;
    weekStart: string;
    programme?: Programme;
    exerciseIds: string[];
  };
  // Legacy snapshots may contain these. They are stripped at the worker boundary
  // and are never used by the text-only workout planner.
  freshPhotos?: Array<{
    view: string;
    mimeType: string;
    base64Data: string;
    recordedDate: string;
  }>;
};

export const nutritionChoiceSchema = z
  .object({
    days: z
      .array(
        z
          .object({
            date: z.string(),
            meals: z
              .array(
                z
                  .object({
                    mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]),
                    foods: z
                      .array(
                        z
                          .object({
                            foodId: z.string().uuid(),
                            grams: z.number().finite().min(5).max(600),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(5),
                  })
                  .strict(),
              )
              .max(4),
          })
          .strict(),
      )
      .length(7),
    reason: z.string().min(1).max(220),
  })
  .strict();

export type NutritionChoice = z.infer<typeof nutritionChoiceSchema>;

// Stored/served exercise shape. Built by the backend from the model's choice.
export const exercisePlanSchema = z
  .object({
    exerciseId: z.string().uuid(),
    name: z.string(),
    displayName: z.string().optional(),
    region: z.enum(REGIONS).optional(),
    pattern: z.string(),
    subTarget: z.string().optional(),
    sets: z.number().int().min(1).max(5),
    repsMin: z.number().int().min(5).max(20),
    repsMax: z.number().int().min(5).max(20),
    weightKg: z.number().finite().min(0).max(500).nullable(),
    weightBasis: z.enum([
      "as_logged",
      "bodyweight",
      "establish_starting_load",
      "estimated_start",
    ]),
    weightUnit: z
      .enum(["per_hand", "total_load", "as_logged", "bodyweight"])
      .optional(),
    targetRpe: z.number().min(5).max(8),
    restSeconds: z.number().int().min(45).max(180),
    setPrescriptions: z
      .array(
        z.object({
          setNumber: z.number().int(),
          repsMin: z.number().int(),
          repsMax: z.number().int(),
          weightKg: z.number().nullable(),
          targetRpe: z.number(),
        }),
      )
      .min(1)
      .max(5),
    reason: z.string().max(300),
    progression: z.string().max(300),
    evidenceIds: z.array(z.string()).max(6),
    alternativeIds: z.array(z.string().uuid()).max(2),
  })
  .strict();

export type ExercisePlan = z.infer<typeof exercisePlanSchema>;

// What the region model returns: only the coaching decisions.
export const regionalChoiceSchema = z
  .object({
    days: z
      .array(
        z
          .object({
            date: dateSchema,
            exercises: z
              .array(
                z
                  .object({
                    exerciseId: z.string(),
                    sets: z.number(),
                    repsMin: z.number(),
                    repsMax: z.number(),
                    weightKg: z.number().nullable(),
                    targetRpe: z.number(),
                    restSeconds: z.number(),
                    reason: z.string(),
                    progression: z.string(),
                    setPrescriptions: z
                      .array(
                        z
                          .object({
                            setNumber: z.number().int().min(1).max(5),
                            reps: z.number().int().min(5).max(20),
                            weightKg: z
                              .number()
                              .finite()
                              .nonnegative()
                              .nullable(),
                            targetRpe: z.number().finite(),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(5)
                      .optional(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .max(7),
  })
  .strict();

export type RegionalChoice = z.infer<typeof regionalChoiceSchema>;

// Normalized per-region result kept in graph state.
export type RegionalResult = {
  days: Array<{ date: string; exercises: ExercisePlan[] }>;
};

export type TrainingDay = {
  date: string;
  regions: Region[];
  exerciseSlots: Partial<Record<Region, number>>;
  minutesPerRegion: number;
  // Focus muscles get a larger share of the day; falls back to minutesPerRegion.
  minutesByRegion?: Partial<Record<Region, number>>;
};

const nutrients = z.object({
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
});

export const planSchema = z
  .object({
    weekStart: dateSchema,
    timezone: z.string(),
    synthetic: z.boolean(),
    historyCoverage: z.object({
      loggedDays: z.number(),
      weeksWithLogs: z.number(),
      syntheticDays: z.number(),
    }),
    summary: z.string().max(600),
    warnings: z.array(z.string()).max(12),
    workouts: z
      .array(
        z.object({
          date: dateSchema,
          name: z.string(),
          restDay: z.boolean(),
          estimatedMinutes: z.number(),
          exercises: z.array(exercisePlanSchema).max(15),
          warmup: z
            .object({
              durationMinutes: z.number().int().min(1).max(15),
              note: z.string().max(400),
              steps: z
                .array(
                  z.object({
                    name: z.string(),
                    instruction: z.string(),
                    seconds: z.number().int().positive(),
                    exerciseId: z.string().uuid().optional(),
                    reps: z.number().int().positive().optional(),
                    weightKg: z.number().nonnegative().nullable().optional(),
                  }),
                )
                .min(1)
                .max(8),
            })
            .optional(),
        }),
      )
      .length(7),
    nutrition: z.object({
      mode: z.enum(["ROUTINE", "AI", "TRACK"]).optional(),
      guidance: z
        .object({ activity: z.string().max(300), review: z.string().max(400) })
        .optional(),
      status: z.enum(["RECOMMENDED", "NEEDS_INPUT"]),
      reason: z.string().max(300),
      targets: nutrients.nullable(),
      days: z
        .array(
          z.object({
            date: dateSchema,
            meals: z
              .array(
                z.object({
                  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]),
                  routineId: z.string().uuid().optional(),
                  foods: z
                    .array(
                      z.object({
                        foodId: z.string().uuid(),
                        name: z.string(),
                        grams: z.number().min(5).max(600).optional(),
                        servings: z.number().positive().max(100).optional(),
                        servingLabel: z.string().max(100).optional(),
                        nutrients: nutrients,
                      }),
                    )
                    .min(1)
                    .max(5),
                  totals: nutrients,
                }),
              )
              .max(4),
            totals: nutrients,
          }),
        )
        .max(7),
    }),
    promptVersion: z.string(),
    ruleVersion: z.string(),
    model: z.string(),
    programme: programmeSchema.optional(),
  })
  .strict();

export type WeeklyPlan = z.infer<typeof planSchema>;
export function requireCompletedPlan(output: { plan?: unknown }): WeeklyPlan {
  if (!output.plan)
    throw new PlannerError(
      "INCOMPLETE_WORKFLOW",
      "The planning workflow did not finish. Your previous plan is unchanged.",
      503,
    );
  return planSchema.parse(output.plan);
}
export class PlannerError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: { nextGenerationAt: string; lastPlanId: string } | { missingMeasurements: string[] },
  ) {
    super(message);
  }
}
export const generateInput = z
  .object({
    weekStart: dateSchema,
    timezone: z.string().min(1).max(80),
    includeDemo: z.literal(false).default(false),
    startDate: dateSchema.optional(),
    trainingDates: z.array(dateSchema).min(1).max(6).optional(),
  })
  .strict()
  .refine(
    (input) => Boolean(input.startDate) === Boolean(input.trainingDates),
    "Choose a start date and training dates together.",
  );

export function dateInZone(timezone: string, now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    throw new PlannerError("INVALID_TIMEZONE", "Choose a valid timezone.");
  }
}
export function addDays(date: string, days: number) {
  const calendarDate = new Date(`${date}T12:00:00Z`);
  calendarDate.setUTCDate(calendarDate.getUTCDate() + days);

  return calendarDate.toISOString().slice(0, 10);
}
