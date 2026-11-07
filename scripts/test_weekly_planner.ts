import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import prisma from "../config/prisma";
import { EQUIPMENT_CATEGORIES } from "../modules/onboarding/equipment_catalog";
import {
  createOnboardingSchema,
  updateOnboardingSchema,
} from "../modules/onboarding/onboarding_types";
import { weekDates } from "../modules/workout/session/session_types";
import { buildWeeklyGraph } from "../graphworkflow/graph";
import {
  nutritionNode,
  portionBounds,
  recommendMeals,
  routineNutrition,
} from "../graphworkflow/nodes/nutrition_node";
import { openaiStructured } from "../graphworkflow/common/model";
import { StructuredModel } from "../graphworkflow/common/model";
import {
  Snapshot,
  RegionalChoice,
  RegionalResult,
  TrainingDay,
  addDays,
  dateInZone,
  PlannerError,
  PROMPT_VERSION,
} from "../graphworkflow/common/types";
import {
  loadSnapshot,
  hashContext,
  trainingSchedule,
} from "../graphworkflow/nodes/prepare_node";
import {
  validatePlan,
  localizePlan,
  buildRegionalResult,
} from "../graphworkflow/nodes/validation_node";
import {
  buildRegionInput,
  regionSetBudget,
  regionRecovery,
} from "../graphworkflow/common/region_input";
import { exerciseRules } from "../graphworkflow/common/loading";
import { curatedFood, foodAllowed } from "../graphworkflow/common/catalog";
import everydayFoods from "../data/generic_foods.json";
import { regionHistory } from "../graphworkflow/common/region_input";
import { loadGuide } from "../graphworkflow/common/region_input";
import { nextLoad } from "../graphworkflow/common/loading";
import {
  requestPlan,
  saveCompletedPlan,
  activatePlan,
  getPlanAvailability,
  getRun,
  getSavedPlan,
  listPlanHistory,
} from "../graphworkflow/service";
import {
  PLANNER_STEPS,
  planProgress,
  reportPlanProgress,
} from "../graphworkflow/progress";

type AgentInput = {
  region: string;
  days: Array<{ date: string; minutes: number; maxExercises: number }>;
  exercises: Array<{
    id: string;
    name: string;
    bodyweight: boolean;
    subTarget: string;
    suggestedKg: number | null;
  }>;
  history: { exercises: unknown[] };
  recovery: { reducedRecovery: boolean };
};

const calls = new Map<string, { prompt: string; input: AgentInput }>();

const fixtureModel: StructuredModel = async (
  schema,
  prompt,
  input,
  validate,
) => {
  const data = input as AgentInput;

  let raw: unknown;

  if (data.region) {
    calls.set(data.region, { prompt, input: data });

    raw = {
      days: data.days.map((day) => {
        const exercise = data.exercises[0]!;
        const weightKg = exercise.bodyweight ? 0 : exercise.suggestedKg;

        return {
          date: day.date,
          exercises: [
            {
              exerciseId: exercise.id,
              sets: 2,
              repsMin: 10,
              repsMax: 10,
              setPrescriptions: [
                { setNumber: 1, reps: 10, weightKg, targetRpe: 6 },
                { setNumber: 2, reps: 10, weightKg, targetRpe: 6 },
              ],
              weightKg,
              targetRpe: 6,
              restSeconds: 90,
              reason: "Fits the selected equipment and training split.",
              progression:
                "Record a manageable load and effort before progressing.",
            },
          ],
        };
      }),
    } satisfies RegionalChoice;
  } else {
    if ("week" in (input as object)) {
      const review = input as {
        regions: Record<string, AgentInput>;
        qualityIssues: string[];
      };
      const repairs = review.qualityIssues.length
        ? Object.entries(review.regions)
            .filter(([, region]) => region.days.length)
            .map(([region, data]) => ({
              region,
              choice: {
                days: data.days.map((day, index) => {
                  const patterns =
                    region === "legs"
                      ? [
                          /squat|lunge|leg press|leg extension/i,
                          /deadlift|hip thrust|bridge/i,
                        ]
                      : region === "back"
                        ? [/row/i, /pull.?down|pull.?up|chin.?up/i]
                        : [];
                  const pool = patterns
                    .map((pattern) =>
                      data.exercises.find((e) => pattern.test(e.name)),
                    )
                    .filter(Boolean) as AgentInput["exercises"];
                  const selected =
                    data.days.length === 1 &&
                    day.maxExercises >= 2 &&
                    day.minutes >= 9 &&
                    pool.length === 2
                      ? pool
                      : [pool[index % pool.length] ?? data.exercises[0]!];
                  return {
                    date: day.date,
                    exercises: selected.map((e) => ({
                      exerciseId: e.id,
                      sets: 2,
                      repsMin: 10,
                      repsMax: 10,
                      weightKg: e.bodyweight ? 0 : e.suggestedKg,
                      targetRpe: 6,
                      restSeconds: 90,
                      reason: "Fixture coordination",
                      progression: "Record reps and effort.",
                    })),
                  };
                }),
              },
            }))
        : [];
      const result = schema.parse({ repairs });
      validate(result);
      return result;
    }
    const nutrition = input as {
      dates: string[];
      candidates: Array<{
        id: string;
        name: string;
        group: string;
        portionBounds: { minimumGrams: number; maximumGrams: number };
      }>;
    };
    function pick(name: RegExp, group: string, grams: number) {
      const food =
        nutrition.candidates.find(
          (food) => name.test(food.name) && food.group === group,
        ) ?? nutrition.candidates.find((food) => food.group === group)!;
      return {
        foodId: food.id,
        grams: Math.min(
          food.portionBounds.maximumGrams,
          Math.max(food.portionBounds.minimumGrams, grams),
        ),
      };
    }
    raw = {
      days: nutrition.dates.map((date, index) => ({
        date,
        meals: [
          {
            mealType: "BREAKFAST",
            foods: [
              pick(/oat/i, "breakfast", 70),
              pick(
                /fat.free Greek yogurt|Greek yogurt.*fat.free/i,
                "protein",
                200,
              ),
              pick(/banana/i, "fruit", 120),
            ],
          },
          {
            mealType: "LUNCH",
            foods: [
              pick(/chicken.*roast/i, "protein", 180),
              pick(/white rice.*cooked/i, "starch", 250),
              pick(/broccoli.*boiled/i, "vegetable", 180),
              pick(/olive oil/i, "fat", 10),
            ],
          },
          {
            mealType: "DINNER",
            foods: [
              pick(
                index % 2 ? /chicken.*roast/i : /lentils.*boiled/i,
                "protein",
                200,
              ),
              pick(/potato.*boiled/i, "starch", 300),
              pick(/broccoli.*boiled/i, "vegetable", 180),
              pick(/olive oil/i, "fat", 10),
            ],
          },
          {
            mealType: "SNACK",
            foods: [
              pick(/banana/i, "fruit", 150),
              pick(/^walnuts?(,|$)/i, "fat", 25),
              pick(
                /fat.free Greek yogurt|Greek yogurt.*fat.free/i,
                "protein",
                150,
              ),
            ],
          },
        ],
      })),
      reason:
        "Simple varied meals for the saved dietary preferences and training days.",
    };
  }

  const parsed = schema.parse(raw);

  validate(parsed);

  return parsed;
};

async function main() {
  const users: string[] = [];

  async function createMember() {
    const user = await prisma.user.create({
      data: {
        email: `planner-test-${randomUUID()}@example.invalid`,
        password: "isolated-test-account",
      },
    });

    users.push(user.id);
    // These fixtures exercise AI food planning; new members default to routines.
    await prisma.userNutritionSettings.create({
      data: { userId: user.id, mode: "AI" },
    });

    await prisma.onboarding.create({
      data: {
        userId: user.id,
        name: "Planner test",
        age: 30,
        gender: "FEMALE",
        height: 170,
        weight: 70,
        workingToward: "BUILD_MUSCLE",
        experience: "INTERMEDIATE",
        daysPerWeek: "DAYS_3",
        workoutDuration: "MIN_45",
        trainingLocation: "GYM",
        equipment: [
          "DUMBBELLS",
          "BARBELLS",
          "CABLE",
          "BENCH",
          "MACHINES",
          "OTHER",
        ],
        equipmentIds: Object.keys(EQUIPMENT_CATEGORIES).filter(
          (id) => id !== "bodyweight_only",
        ),
        activityLevel: "MODERATE",
        sleepDuration: "HOURS_7_TO_8",
        eatingStyle: "NO_PREFERENCE",
        limitations: ["NONE"],
        trainingDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
        trainingSplit: "FULL_BODY",
      },
    });

    return user.id;
  }

  try {
    const userId = await createMember();

    const week = addDays(weekDates(dateInZone("Asia/Kolkata"))[0]!, 7);

    const snapshot = await loadSnapshot(userId, week, "Asia/Kolkata");

    // Row order and JSONB key order must not reject an otherwise identical plan.
    const hashSample: Snapshot = {
      ...snapshot,
      sets: [
        {
          id: "set-a",
          exerciseId: "exercise-a",
          date: snapshot.cutoff,
          set: 1,
          reps: 10,
          weight: 20,
          rpe: 7,
          synthetic: false,
        },
        {
          id: "set-b",
          exerciseId: "exercise-b",
          date: snapshot.cutoff,
          set: 1,
          reps: 12,
          weight: 5,
          rpe: null,
          synthetic: false,
        },
      ],
    };
    const reordered = JSON.parse(JSON.stringify(hashSample)) as Snapshot;
    reordered.sets.reverse();
    reordered.candidates.reverse();
    reordered.foods.reverse();
    reordered.profile = Object.fromEntries(
      Object.entries(reordered.profile).reverse(),
    ) as Snapshot["profile"];
    assert.equal(hashContext(hashSample), hashContext(reordered));
    assert.equal(
      hashSample.sets[0]!.id,
      "set-a",
      "Hashing must not mutate prompts.",
    );
    reordered.sets[0]!.weight = 25;
    assert.notEqual(hashContext(hashSample), hashContext(reordered));
    reordered.sets[0]!.weight = hashSample.sets[1]!.weight;
    reordered.profile.limitations = ["SHOULDER"];
    assert.notEqual(hashContext(hashSample), hashContext(reordered));

    assert.equal(snapshot.sets.length, 0);
    assert.equal(snapshot.synthetic, false);
    assert(
      snapshot.candidates.filter((candidate) => candidate.region === "chest")
        .length > 12,
    );

    await assert.rejects(
      () => loadSnapshot(userId, week, "Asia/Kolkata", true),
      (error) =>
        error instanceof PlannerError && error.code === "DEMO_HISTORY_DISABLED",
    );

    const completed = new Set<string>();

    const graph = buildWeeklyGraph({
      model: fixtureModel,
      checkpointer: new MemorySaver(),
      stage: async (_, step) => {
        if (step) completed.add(step);
      },
    });

    const result = await graph.invoke(
      { snapshot },
      { configurable: { thread_id: randomUUID() }, maxConcurrency: 3 },
    );

    validatePlan(snapshot, result.plan);

    assert.equal(result.plan.workouts.length, 7);
    assert.equal(
      Object.keys(result.regions).length,
      7,
      "Reducer must preserve every parallel agent.",
    );
    assert.deepEqual(
      [...completed].sort(),
      PLANNER_STEPS.filter((step) => step !== "saved").sort(),
    );
    assert.equal(result.plan.promptVersion, PROMPT_VERSION);
    if (result.plan.nutrition.status !== "RECOMMENDED") {
      // Surface the provider fixture error instead of the safe food fallback.
      const foodResult = await recommendMeals(
        snapshot,
        result.plan,
        fixtureModel,
      );
      assert.equal(foodResult.status, "RECOMMENDED", foodResult.reason);
    }
    assert.equal(
      result.plan.nutrition.status,
      "RECOMMENDED",
      result.plan.nutrition.reason,
    );

    // A private saved meal can replace a suggested breakfast without changing
    // the day's nutrients. The validator must keep that exact routine portion.
    const hybridSnapshot: Snapshot = {
      ...snapshot,
      routineMeals: result.plan.nutrition.days.map((day) => {
        const breakfast = day.meals.find((m) => m.mealType === "BREAKFAST")!;
        return {
          routineId: randomUUID(),
          date: day.date,
          mealType: "BREAKFAST" as const,
          entry: {
            nutritionId: randomUUID(),
            name: "My breakfast",
            servings: 1,
            servingSize: 1,
            servingUnit: "portion",
            imageUrl: null,
            ...breakfast.totals,
            fiber: 0,
            sugar: 0,
            sodiumMg: 0,
          },
        };
      }),
    };
    const hybridPlan = structuredClone(result.plan);
    for (const day of hybridPlan.nutrition.days) {
      const fixed = hybridSnapshot.routineMeals!.find(
        (r) => r.date === day.date,
      )!;
      const breakfast = day.meals.find((m) => m.mealType === "BREAKFAST")!;
      breakfast.routineId = fixed.routineId;
      breakfast.foods = [
        {
          foodId: fixed.entry.nutritionId,
          name: fixed.entry.name,
          servings: 1,
          servingLabel: "1 portion",
          nutrients: { ...breakfast.totals },
        },
      ];
    }
    validatePlan(hybridSnapshot, hybridPlan);
    const routinePlan = {
      ...hybridPlan,
      nutrition: routineNutrition(hybridSnapshot),
    };
    validatePlan(
      {
        ...hybridSnapshot,
        profile: { ...snapshot.profile, nutritionMode: "ROUTINE" },
      },
      routinePlan,
    );
    const changedRoutine = structuredClone(hybridPlan);
    changedRoutine.nutrition.days[0]!.meals.find(
      (m) => m.mealType === "BREAKFAST",
    )!.foods[0]!.servings = 2;
    assert.throws(
      () => validatePlan(hybridSnapshot, changedRoutine),
      /Routine portions changed/,
    );

    const originalPlan = JSON.stringify(result.plan);
    for (const language of [
      "de",
      "de-CH",
      "fr",
      "sv",
      "no",
      "da",
      "nl",
      "es",
      "it",
    ]) {
      const translate: StructuredModel = async (
        schema,
        system,
        input: any,
        validate,
      ) => {
        assert(system.includes("OUTPUT LANGUAGE:"));
        assert.equal(input.language, language);
        const translated = schema.parse({
          texts: input.texts.map((text: string) => "Oversat: " + text),
        });
        validate(translated);
        return translated;
      };
      const localized = await localizePlan(result.plan, language, translate);
      validatePlan(snapshot, localized);
      assert(localized.summary.startsWith("Oversat: "));
      assert(
        localized.workouts.every((day: any) =>
          day.name.startsWith("Oversat: "),
        ),
      );
      assert.equal(
        localized.workouts[0]?.exercises[0]?.weightKg,
        result.plan.workouts[0]?.exercises[0]?.weightKg,
      );
      for (const day of localized.workouts) {
        assert(
          day.exercises.every((exercise) =>
            exercise.displayName?.startsWith("Oversat: "),
          ),
        );
      }
      assert.deepEqual(
        localized.workouts.map((day: any) =>
          day.exercises.map((exercise: any) => exercise.setPrescriptions),
        ),
        result.plan.workouts.map((day: any) =>
          day.exercises.map((exercise: any) => exercise.setPrescriptions),
        ),
      );
      assert.equal(
        JSON.stringify(result.plan),
        originalPlan,
        "Localization must not mutate the validated source plan",
      );
    }
    const badTranslation: StructuredModel = async (
      schema,
      _system,
      input: any,
      validate,
    ) => {
      const translated = schema.parse({
        texts: input.texts.map((text: string) => text + " 999"),
      });
      validate(translated);
      return translated;
    };
    await assert.rejects(
      localizePlan(result.plan, "da", badTranslation),
      /numeric value/,
    );

    for (const day of result.plan.nutrition.days) {
      assert.equal(day.meals.length, 4);
      for (const meal of day.meals) {
        for (const item of meal.foods) {
          const food = snapshot.foods.find((food) => food.id === item.foodId)!;
          const bounds = portionBounds(food);
          assert(
            item.grams !== undefined &&
              item.grams >= bounds.minimumGrams &&
              item.grams <= bounds.maximumGrams,
          );
        }
      }
    }
    const mealsByDay = result.plan.nutrition.days.map((day) =>
      JSON.stringify(
        day.meals.map((meal) => meal.foods.map((food) => food.foodId)),
      ),
    );
    assert(
      new Set(mealsByDay).size > 1,
      "Keep agent-selected meal variation across the week.",
    );

    const chestCall = calls.get("chest")!;

    assert.ok(
      chestCall.input.exercises.length >=
        snapshot.candidates.filter((candidate) => candidate.region === "chest")
          .length,
      "All chest exercises must be passed to the node.",
    );
    assert.ok(
      chestCall.input.exercises.every((exercise) => exercise.subTarget),
      "Every exercise must have a subTarget.",
    );
    assert.ok(
      chestCall.input.history.exercises.length >= 0,
      "History exercises array must be present.",
    );
    assert(!JSON.stringify(chestCall.input).includes('"instructions"'));
    assert(!JSON.stringify(chestCall.input).includes('"thumbnailUrl"'));
    assert(chestCall.prompt.includes("upper_chest"));
    assert(chestCall.prompt.includes("chest programming specialist"));
    assert(!chestCall.prompt.includes("visually inspect"));
    assert(!chestCall.prompt.includes("The backend calculates sets"));

    const exercises = result.plan.workouts.flatMap((day) => day.exercises);

    assert(
      exercises.every((exercise) =>
        exercise.setPrescriptions.every((set) => set.repsMin === set.repsMax),
      ),
      "Every new set needs an exact rep target.",
    );

    const weighted = snapshot.candidates.find(
      (candidate) =>
        !candidate.bodyweight &&
        candidate.compound &&
        /dumbbell/i.test(candidate.equipment),
    )!;
    assert(weighted);
    const progressionReps = exerciseRules(snapshot, weighted, false).maxReps;
    const successfulSets = ["2026-10-08", "2026-10-10"].flatMap((date) =>
      [1, 2, 3].map((set) => ({
        id: randomUUID(),
        exerciseId: weighted.id,
        date,
        set,
        reps: progressionReps,
        weight: 20,
        rpe: 6,
        synthetic: false,
        plannedRepsMin: progressionReps,
        plannedRepsMax: progressionReps,
        plannedSets: 3,
      })),
    );
    const progressionArgs = {
      candidate: weighted,
      profile: snapshot.profile,
      reducedRecovery: false,
      logs: successfulSets,
    };
    assert.equal(nextLoad(progressionArgs).suggestedKg, 21);
    assert.equal(
      nextLoad({
        ...progressionArgs,
        logs: successfulSets.map((set) => ({ ...set, rpe: null })),
      }).suggestedKg,
      20,
    );
    assert.equal(
      nextLoad({ ...progressionArgs, logs: successfulSets.slice(3) })
        .suggestedKg,
      20,
    );
    assert.equal(
      nextLoad({ ...progressionArgs, reducedRecovery: true }).suggestedKg,
      20,
    );
    assert.equal(
      nextLoad({
        ...progressionArgs,
        logs: successfulSets.map((set) => ({ ...set, weight: 2 })),
      }).suggestedKg,
      2,
      "Do not prescribe unavailable micro increments or large percentage jumps.",
    );
    assert.equal(
      loadGuide({ ...snapshot, sets: successfulSets }, weighted, false)
        .maxSafeKg,
      21,
    );

    const beginner = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        experience: "BEGINNER",
        goal: "BUILD_STRENGTH",
        customLimitations: "Avoid overhead work",
        limitations: ["SHOULDER"],
        language: "da",
      },
    };
    assert.equal(exerciseRules(beginner, weighted, false).maxSets, 3);
    assert.equal(exerciseRules(beginner, weighted, false).minReps, 8);
    const fourSetHistory = successfulSets
      .filter((set) => set.set === 1)
      .flatMap((set) =>
        [1, 2, 3, 4].map((number) => ({
          ...set,
          id: randomUUID(),
          set: number,
          plannedSets: 4,
        })),
      );
    assert.equal(
      exerciseRules({ ...beginner, sets: fourSetHistory }, weighted, false)
        .maxSets,
      4,
    );
    assert.equal(
      exerciseRules({ ...beginner, sets: fourSetHistory }, weighted, true)
        .maxSets,
      2,
    );
    const isolation = snapshot.candidates.find(
      (candidate) => !candidate.compound,
    )!;
    const strengthRules = exerciseRules(
      { ...snapshot, profile: { ...snapshot.profile, goal: "BUILD_STRENGTH" } },
      isolation,
      false,
    );
    assert(strengthRules.minReps <= strengthRules.maxReps);
    assert.equal(strengthRules.minReps, isolation.region === "core" ? 12 : 10);
    const regionInput = buildRegionInput(
      beginner,
      trainingSchedule(beginner),
      weighted.region,
    );
    assert.equal(regionInput.client.customLimitations, "Avoid overhead work");
    assert.deepEqual(regionInput.client.limitations, ["SHOULDER"]);
    assert.equal(regionInput.language, "da");
    assert.equal(regionInput.history.sessions.length, beginner.sessions.length);
    assert(
      regionInput.exercises.every(
        (exercise) => exercise.prescriptionRules.maxSets <= 3,
      ),
    );
    const recentDate = snapshot.cutoff;
    const recovery = regionRecovery(
      {
        ...snapshot,
        wellness: [
          {
            date: recentDate,
            sleepMinutes: 420,
            energy: 4,
            rested: 4,
            soreness: 1,
            source: "MANUAL",
          },
        ],
        health: [
          {
            date: recentDate,
            sleepMinutes: 480,
            steps: null,
            hrv: null,
            restingHR: null,
            source: "HEALTH_CONNECT",
          },
        ],
      },
      "chest",
    );
    assert.equal(
      recovery.avgSleepMinutes,
      480,
      "Do not count manual and synced sleep twice.",
    );
    const photoContext = buildRegionInput(
      {
        ...snapshot,
        measurements: [
          {
            id: randomUUID(),
            date: snapshot.cutoff,
            source: "photo",
            metrics: {
              chestCm: {
                value: 100,
                source: "contour_estimate",
                low: 90,
                high: 110,
              },
            },
          },
          {
            id: randomUUID(),
            date: snapshot.historyStart,
            source: "manual",
            metrics: { chestCm: { value: 99, source: "tape" } },
          },
        ],
      },
      trainingSchedule(snapshot),
      "chest",
    );
    assert.equal(
      (photoContext.body?.metrics.chestCm as { value: number }).value,
      99,
    );
    assert(!JSON.stringify(photoContext.body).includes("contour_estimate"));
    for (const name of [
      "Boiled egg",
      "Fat-free Greek yogurt",
      "Rolled oats — dry",
      "Chicken breast — roasted, skinless",
      "White rice — cooked",
    ]) {
      const row = everydayFoods.foods.find((food) => food.name === name)!;
      const food = curatedFood({ ...row, imageUrl: null });
      assert(food, name + " should be available to the planner");
      if (/egg|yogurt/i.test(name)) {
        assert(
          foodAllowed(food, { ...snapshot.profile, eatingStyle: "VEGETARIAN" }),
        );
        assert(
          !foodAllowed(food, { ...snapshot.profile, eatingStyle: "VEGAN" }),
        );
      }
    }

    const rampedSets = successfulSets.map((set) => ({
      ...set,
      weight: set.set === 1 ? 16 : 20,
    }));
    const rampedGuide = loadGuide(
      { ...snapshot, sets: rampedSets },
      weighted,
      false,
    );
    assert.equal(rampedGuide.setCeilingsKg[0], 17);
    assert.equal(rampedGuide.setCeilingsKg[1], 21);
    const inconsistentUnits = successfulSets.map((set) => ({
      ...set,
      weightUnit: (set.date === "2026-10-08" ? "per_hand" : "total_load") as
        "per_hand" | "total_load",
    }));
    assert.equal(
      nextLoad({ ...progressionArgs, logs: inconsistentUnits }).action,
      "start",
    );

    const boiledLentils = snapshot.foods.find((food) =>
      /lentils.*boiled/i.test(food.name),
    )!;
    assert.equal(
      portionBounds(boiledLentils).minimumGrams,
      100,
      "Boiled foods are not cooking oil.",
    );
    const oil = snapshot.foods.find((food) => /^olive oil$/i.test(food.name))!;
    assert.equal(portionBounds(oil).maximumGrams, 20);

    const unknownBarbell = snapshot.candidates.find((candidate) =>
      /^barbell$/i.test(candidate.equipment),
    )!;
    assert.equal(loadGuide(snapshot, unknownBarbell, false).suggestedKg, null);
    assert(
      !snapshot.candidates.some((candidate) =>
        /assisted/i.test(candidate.name),
      ),
    );
    const goblet = snapshot.candidates.find((candidate) =>
      !candidate.bodyweight && /goblet/i.test(candidate.name),
    );
    if (goblet)
      assert.equal(loadGuide(snapshot, goblet, false).weightUnit, "total_load");
    const pulldown = snapshot.candidates.find((candidate) =>
      /lat.*pull.?down/i.test(candidate.name),
    );
    if (pulldown) assert.equal(pulldown.compound, true);

    const barbellDays = scheduleFor(snapshot, unknownBarbell.region);
    const unknownLoadResult = buildRegionalResult(
      snapshot,
      barbellDays,
      unknownBarbell.region,
      {
        days: barbellDays.map((day) => ({
          date: day.date,
          exercises: [
            {
              exerciseId: unknownBarbell.id,
              sets: 2,
              repsMin: 10,
              repsMax: 10,
              weightKg: 100,
              targetRpe: 6,
              restSeconds: 120,
              reason: "Use a compatible movement.",
              progression: "Choose a comfortable starting load.",
              setPrescriptions: [1, 2].map((number) => ({
                setNumber: number,
                reps: 10,
                weightKg: 100,
                targetRpe: 6,
              })),
            },
          ],
        })),
      },
    );
    assert(
      unknownLoadResult.days.every((day) =>
        day.exercises.every(
          (exercise) =>
            exercise.weightKg === null &&
            exercise.weightBasis === "establish_starting_load" &&
            exercise.setPrescriptions.every((set) => set.weightKg === null),
        ),
      ),
      "Do not accept an invented barbell load from the model when the starting load is unknown.",
    );

    const weightedRegion = weighted.region;
    const assignedDays = scheduleFor(snapshot, weightedRegion);
    const oversized = buildRegionalResult(
      { ...snapshot, sets: successfulSets },
      assignedDays,
      weightedRegion,
      {
        days: assignedDays.map((day) => ({
          date: day.date,
          exercises: [
            {
              exerciseId: weighted.id,
              sets: 2,
              repsMin: 10,
              repsMax: 10,
              weightKg: 25,
              targetRpe: 10,
              restSeconds: 90,
              reason: "Use the familiar exercise.",
              progression: "Log actual effort.",
              setPrescriptions: [
                { setNumber: 1, reps: 10, weightKg: 20, targetRpe: 6 },
                { setNumber: 2, reps: 10, weightKg: 25, targetRpe: 10 },
              ],
            },
          ],
        })),
      },
    );
    assert(
      oversized.days.every((day) =>
        day.exercises.every((exercise) =>
          exercise.setPrescriptions.every(
            (set) => (set.weightKg ?? 0) <= 21 && set.targetRpe <= 8,
          ),
        ),
      ),
    );

    assert(
      exercises.every(
        (exercise) =>
          exercise.repsMin === exercise.repsMax &&
          exercise.repsMin >= 8 &&
          exercise.restSeconds === 90,
      ),
      "Backend must preserve valid agent numeric output instead of replacing it with hardcoded values.",
    );
    assert(
      exercises.every(
        (exercise) =>
          exercise.weightBasis !== "as_logged" || exercise.weightKg == null,
      ),
      "Cold-start exercises must not use as_logged weight basis.",
    );
    assert(
      exercises.every((exercise) => exercise.subTarget),
      "Every exercise in the plan must carry a subTarget.",
    );

    // regionHistory is now exported from region_input.ts, not prepare_node.
    const shoulder = snapshot.candidates.find(
      (candidate) => candidate.region === "shoulders",
    )!;

    const schedule = trainingSchedule(snapshot);
    const regionData = regionHistory(
      {
        ...snapshot,
        sets: [
          {
            id: randomUUID(),
            exerciseId: shoulder.id,
            date: snapshot.cutoff,
            set: 1,
            reps: 10,
            weight: 20,
            rpe: 7,
            synthetic: false,
            primaryMuscles: ["shoulders"],
            secondaryMuscles: ["triceps"],
          },
        ],
      },
      schedule,
      "triceps",
    );
    assert.equal(
      regionData.length >= 0,
      true,
      "regionHistory returns an array.",
    );

    const custom: Snapshot = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        trainingSplit: "CUSTOM",
        customTrainingSplit: {
          MONDAY: ["biceps", "triceps"],
          WEDNESDAY: ["chest", "legs"],
          FRIDAY: ["back", "shoulders", "core"],
        },
      },
    };

    const customResult = await graph.invoke(
      { snapshot: custom },
      { configurable: { thread_id: randomUUID() }, maxConcurrency: 3 },
    );
    const monday = customResult.plan.workouts[0]!;
    assert.deepEqual(
      monday.exercises.map(
        (exercise) =>
          snapshot.candidates.find(
            (candidate) => candidate.id === exercise.exerciseId,
          )!.region,
      ),
      ["biceps", "triceps"],
    );
    assert.equal(monday.name, "Biceps + Triceps");
    assert.equal(customResult.plan.workouts[2]!.name, "Chest + Legs");

    for (const split of [
      "AUTO",
      "FULL_BODY",
      "UPPER_LOWER",
      "PUSH_PULL_LEGS",
      "MUSCLE_FOCUSED",
    ] as const) {
      const schedule = trainingSchedule({
        ...snapshot,
        profile: { ...snapshot.profile, trainingSplit: split },
      });
      assert.equal(schedule.length, 3);
      assert(schedule.every((day) => day.regions.length > 0));
    }

    assert.throws(
      () =>
        trainingSchedule({
          ...custom,
          profile: { ...custom.profile, customTrainingSplit: {} },
        }),
      /every custom training day/,
    );
    assert.equal(
      updateOnboardingSchema.parse({
        trainingSplit: "CUSTOM",
        customTrainingSplit: { MONDAY: ["chest", "legs"] },
      }).trainingSplit,
      "CUSTOM",
    );
    assert.equal(
      updateOnboardingSchema.parse({ name: "Updated" }).trainingSplit,
      undefined,
    );
    assert.equal(
      createOnboardingSchema.shape.customTrainingSplit.safeParse({
        MONDAY: ["chest", "chest"],
      }).success,
      false,
    );

    // Saving a real plan publishes the dated workouts/food suggestions atomically.
    const run = await requestPlan(userId, week, "Asia/Kolkata");
    const lease = randomUUID();

    await prisma.weeklyPlanRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        leaseToken: lease,
        leaseUntil: new Date(Date.now() + 180000),
      },
    });
    await Promise.all([
      reportPlanProgress(run.id, lease, "specialists", "chest"),
      reportPlanProgress(run.id, lease, "specialists", "back"),
    ]);
    const reporting = await prisma.weeklyPlanRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    assert.equal(
      planProgress(reporting.progress, false).completedSteps.length,
      2,
    );
    const saved = await saveCompletedPlan(run.id, result.plan, lease);
    assert.equal(saved.status, "ACTIVE");
    assert.equal(
      await prisma.userWorkout.count({ where: { userId, weekLabel: week } }),
      3,
    );
    assert.equal(await prisma.workoutDay.count({ where: { userId } }), 7);
    assert.equal(
      await prisma.workoutSetLog.count({ where: { userId } }),
      0,
      "Plans never fabricate completed sets.",
    );
    assert.equal(
      await prisma.userMealLog.count({ where: { userId } }),
      0,
      "Suggestions never fabricate logged meals.",
    );
    assert.equal(
      await prisma.userMealPlan.count({ where: { userId, weekLabel: week } }),
      1,
    );
    assert.equal((await getRun(userId, run.id)).progress.percent, 100);
    assert.equal(
      (await saveCompletedPlan(run.id, result.plan, lease)).id,
      saved.id,
    );
    assert.equal((await activatePlan(userId, saved.id)).status, "ACTIVE");
    assert.equal((await getPlanAvailability(userId)).cooldownActive, true);
    await assert.rejects(
      () => requestPlan(userId, week, "Asia/Kolkata"),
      (error) =>
        error instanceof PlannerError && error.code === "PLAN_COOLDOWN",
    );

    const otherUser = await createMember();
    await assert.rejects(
      () => getSavedPlan(otherUser, saved.id),
      (error) => error instanceof PlannerError && error.code === "NOT_FOUND",
    );
    assert.equal((await listPlanHistory(userId)).items.length, 1);

    const otherSnapshot = await loadSnapshot(otherUser, week, "Asia/Kolkata");
    const otherResult = await graph.invoke(
      { snapshot: otherSnapshot },
      { configurable: { thread_id: randomUUID() }, maxConcurrency: 3 },
    );
    // WEEK_STARTED fires only when every day of the week is already started.
    const otherRun = await requestPlan(otherUser, week, "Asia/Kolkata");
    for (const day of otherResult.plan.workouts) {
      await prisma.userWorkout.create({
        data: {
          userId: otherUser,
          scheduledDate: day.date,
          weekLabel: week,
          status: "IN_PROGRESS",
        },
      });
    }
    await assert.rejects(
      () => saveCompletedPlan(otherRun.id, otherResult.plan),
      (error) => error instanceof PlannerError && error.code === "WEEK_STARTED",
    );
    assert.equal(
      await prisma.weeklyPersonalPlan.count({ where: { userId: otherUser } }),
      0,
    );
    assert.equal((await getPlanAvailability(otherUser)).cooldownActive, false);
    assert.equal(
      await prisma.userWorkout.count({
        where: { userId: otherUser, status: "IN_PROGRESS" },
      }),
      otherResult.plan.workouts.length, // All 7 days preserved untouched.
    );

    console.log(
      "PASS: full catalogs; personalized structured agents; reducers; cold start; real 21-day data; splits; numeric/evidence/load validation; automatic atomic publication; progress; ownership; cooldown; preservation of started workouts.",
    );

    if (process.argv.includes("--live-food")) {
      const started = Date.now();
      const actual = await nutritionNode(
        { ...result, snapshot },
        openaiStructured,
        async () => {},
      );
      validatePlan(snapshot, actual.plan);
      assert.equal(
        actual.plan.nutrition.status,
        "RECOMMENDED",
        actual.plan.nutrition.reason,
      );
      const fs = await import("node:fs/promises");
      await fs.mkdir("build/planner-review", { recursive: true });
      await fs.writeFile(
        "build/planner-review/latest-test-nutrition.json",
        JSON.stringify(actual.plan.nutrition, null, 2),
      );
      console.log(
        JSON.stringify({
          liveNutritionValidated: true,
          days: actual.plan.nutrition.days.length,
          seconds: Math.round((Date.now() - started) / 1000),
        }),
      );
    }

    if (process.argv.includes("--live")) {
      const started = Date.now();

      const liveGraph = buildWeeklyGraph({
        stage: async (_, step) => {
          if (step) console.log(`Live model milestone: ${step}`);
        },
      });

      const liveResult = await liveGraph.invoke(
        { snapshot },
        { maxConcurrency: 3 },
      );

      validatePlan(snapshot, liveResult.plan);
      const fs = await import("node:fs/promises");
      await fs.mkdir("build/planner-review", { recursive: true });
      await fs.writeFile(
        "build/planner-review/latest-test-plan.json",
        JSON.stringify(liveResult.plan, null, 2),
      );

      console.log(
        JSON.stringify({
          liveOpenAIValidated: true,
          seconds: Math.round((Date.now() - started) / 1000),
          trainingDays: liveResult.plan.workouts.filter((day) => !day.restDay)
            .length,
          nutritionStatus: liveResult.plan.nutrition.status,
        }),
      );
    }
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
}

function scheduleFor(
  snapshot: Snapshot,
  region: import("../graphworkflow/common/types").Region,
) {
  return trainingSchedule(snapshot).filter((day) =>
    day.regions.includes(region),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
