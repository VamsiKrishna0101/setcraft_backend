import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import routes from "../modules/nutrition/nutrition_routes";
import {
  actionSchema,
  calendarDate,
  routineSchema,
  savedMealSchema,
  settingsSchema,
  slots,
  saveMeal,
  saveRoutine,
  saveNutritionSettings,
  nutritionSettings,
  plannedDay,
  actOnPlannedMeal,
  deleteRoutine,
  routineMealsForWeek,
} from "../modules/nutrition/food_planning_service";
import { deleteUserMealLog } from "../modules/nutrition/nutrition_service";
import { addDays, dateInZone, WeeklyPlan } from "../graphworkflow/common/types";
import { loadSnapshot } from "../graphworkflow/nodes/prepare_node";
import {
  expectedMealSlots,
  portionBounds,
  recommendMeals,
  safeNutrition,
} from "../graphworkflow/nodes/nutrition_node";
import { StructuredModel } from "../graphworkflow/common/model";
import { curatedFood, foodAllowed } from "../graphworkflow/common/catalog";

async function totals() {
  return {
    foods: await prisma.nutrition.count({
      where: { userId: null, isArchived: false },
    }),
    logs: await prisma.userMealLog.count(),
    planItems: await prisma.userMealPlanItem.count(),
  };
}

async function main() {
  const before = await totals();
  const owners: string[] = [];
  const app = express();
  app.use(express.json());
  app.use("/nutrition", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/nutrition/me/food-planning`;
  try {
    for (let n = 0; n < 2; n++)
      owners.push(
        (
          await prisma.user.create({
            data: {
              email: `food-routine-${randomUUID()}@example.invalid`,
              password: "isolated-test",
              trialStartedAt: new Date(),
              trialEndsAt: new Date(Date.now() + 86400000),
            },
          })
        ).id,
      );
    const user = owners[0]!,
      other = owners[1]!;
    const today = dateInZone("UTC"),
      tomorrow = addDays(today, 1);
    const allDays = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ] as const;
    const settings = {
      mode: "ROUTINE" as const,
      mealSlots: [...slots],
      timezone: "UTC",
    };
    const request = (path: string, body?: unknown, owner = user) =>
      fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt.sign({ userId: owner }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" })}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await fetch(base + "/settings")).status, 401);
    assert.equal((await request("/day/2026-02-30")).status, 400);
    assert.equal(
      (await request("/meals", { name: "Only a name" })).status,
      400,
    );
    assert.equal(calendarDate.safeParse("2026-02-30").success, false);
    assert.equal(
      savedMealSchema.safeParse({
        name: "Bad",
        manual: { calories: -1, protein: 0, carbs: 0, fat: 0 },
      }).success,
      false,
    );
    assert.equal(
      settingsSchema.safeParse({ ...settings, timezone: "bad-zone" }).success,
      false,
    );
    assert.equal(routineSchema.safeParse({ days: [] }).success, false);
    assert.equal(
      actionSchema.safeParse({
        sourceKey: `routine:${randomUUID()}`,
        action: "REPLACE",
      }).success,
      false,
    );
    assert.equal((await nutritionSettings(user)).mode, "ROUTINE");

    const manual = await saveMeal(
      user,
      savedMealSchema.parse({
        name: "My breakfast",
        manual: { calories: 400, protein: 30, carbs: 40, fat: 12, fiber: 6 },
      }),
    );
    assert.equal(manual.imageUrl, null);
    assert.equal(manual.servingUnit, "portion");
    assert.equal(
      await prisma.userMealLog.count({ where: { userId: user } }),
      0,
      "Saving is not eating",
    );
    const wheyRow = await prisma.nutrition.findFirstOrThrow({
      where: { userId: null, name: "Whey protein", isArchived: false },
    });
    const mixed = await saveMeal(
      user,
      savedMealSchema.parse({
        name: "Breakfast and whey",
        components: [
          { nutritionId: manual.id, servings: 0.5 },
          { nutritionId: wheyRow.id, servings: 0.3 },
        ],
      }),
    );
    assert.equal(
      mixed.proteinPerServing,
      Math.round((15 + wheyRow.proteinPerServing * 0.3) * 10) / 10,
    );
    const foreign = await saveMeal(
      other,
      savedMealSchema.parse({
        name: "Private meal",
        manual: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      }),
    );
    await assert.rejects(
      () =>
        saveMeal(user, {
          name: "Not mine",
          components: [{ nutritionId: foreign.id, servings: 1 }],
        }),
      /available/,
    );

    await saveNutritionSettings(user, { ...settings, mode: "TRACK" });
    const input = routineSchema.parse({
      nutritionId: manual.id,
      mealType: "BREAKFAST",
      days: allDays,
      servings: 1,
      startsOn: today,
    });
    const routine = await saveRoutine(user, input);
    assert.equal(
      (await nutritionSettings(user)).mode,
      "ROUTINE",
      "An active routine must be visible",
    );
    await assert.rejects(() => saveRoutine(user, input), /already uses/);
    await assert.rejects(
      () =>
        saveRoutine(other, { ...input, nutritionId: foreign.id }, routine.id),
      /not found/,
    );
    const key = `routine:${routine.id}`;
    assert.equal((await plannedDay(user, today)).meals[0]!.status, "PENDING");
    assert.equal((await plannedDay(other, today)).meals.length, 0);
    await actOnPlannedMeal(user, today, { sourceKey: key, action: "SKIPPED" });
    assert.equal(
      await prisma.userMealLog.count({ where: { userId: user } }),
      0,
      "Skipping is not eating",
    );
    await actOnPlannedMeal(user, today, { sourceKey: key, action: "RESET" });
    await assert.rejects(
      () =>
        actOnPlannedMeal(user, tomorrow, {
          sourceKey: key,
          action: "LOGGED",
          timezone: "UTC",
        }),
      /day you eat/,
    );
    await actOnPlannedMeal(user, tomorrow, {
      sourceKey: key,
      action: "REPLACE",
      replacement: { nutritionId: mixed.id, servings: 2 },
    });
    assert.equal(
      (await plannedDay(user, today)).meals[0]!.entries[0]!.nutritionId,
      manual.id,
    );
    assert.equal(
      (await plannedDay(user, tomorrow)).meals[0]!.entries[0]!.nutritionId,
      mixed.id,
    );
    await actOnPlannedMeal(user, tomorrow, { sourceKey: key, action: "RESET" });
    assert.equal(
      (await plannedDay(user, tomorrow)).meals[0]!.entries[0]!.nutritionId,
      manual.id,
    );
    await assert.rejects(
      () =>
        actOnPlannedMeal(other, today, { sourceKey: key, action: "LOGGED" }),
      /no longer available/,
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        actOnPlannedMeal(user, today, {
          sourceKey: key,
          action: "LOGGED",
          timezone: "UTC",
        }),
      ),
    );
    let logs = await prisma.userMealLog.findMany({ where: { userId: user } });
    assert.equal(logs.length, 1, "Concurrent confirmations must be idempotent");
    assert.equal(logs[0]!.calories, 400);
    assert.equal(logs[0]!.fiber, 6);
    await assert.rejects(
      () =>
        actOnPlannedMeal(user, today, { sourceKey: key, action: "SKIPPED" }),
      /already logged/,
    );
    await saveRoutine(
      user,
      { ...input, servings: 2, paused: true },
      routine.id,
    );
    assert.equal(
      (await plannedDay(user, today)).meals[0]!.entries[0]!.servings,
      1,
      "Dated snapshots survive routine edits",
    );
    assert.equal((await plannedDay(user, tomorrow)).meals.length, 0);
    await saveRoutine(user, input, routine.id);
    await deleteUserMealLog(user, logs[0]!.id);
    assert.equal((await plannedDay(user, today)).meals[0]!.status, "PENDING");
    await actOnPlannedMeal(user, today, {
      sourceKey: key,
      action: "LOGGED",
      timezone: "UTC",
    });
    assert.equal(
      await prisma.userMealLog.count({ where: { userId: user } }),
      1,
    );

    // Existing partial AI confirmations are excluded from the remaining meal.
    const monday = addDays(
      today,
      -(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7,
    );
    const dayOfWeek =
      allDays[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7]!;
    await saveNutritionSettings(user, { ...settings, mode: "AI" });
    const planFood = (servings: number) => ({
      nutritionId: wheyRow.id,
      dayOfWeek,
      mealType: "LUNCH" as const,
      servings,
      mealName: wheyRow.name,
      targetCalories: wheyRow.caloriesPerServing * servings,
      targetProtein: wheyRow.proteinPerServing * servings,
      targetCarbs: wheyRow.carbsPerServing * servings,
      targetFat: wheyRow.fatPerServing * servings,
    });
    const plan = await prisma.userMealPlan.create({
      data: {
        userId: user,
        weekLabel: monday,
        items: {
          create: [{ ...planFood(0.3), status: "LOGGED" }, planFood(0.2)],
        },
      },
    });
    const lunch = (await plannedDay(user, today)).meals.find(
      (m) => m.mealType === "LUNCH",
    )!;
    assert.equal(lunch.entries.length, 1);
    assert.equal(lunch.entries[0]!.servings, 0.2);
    await actOnPlannedMeal(user, today, {
      sourceKey: `plan:${plan.id}:LUNCH`,
      action: "LOGGED",
      timezone: "UTC",
    });
    assert.equal(
      await prisma.userMealLog.count({ where: { userId: user } }),
      2,
    );

    await prisma.onboarding.create({
      data: {
        userId: user,
        name: "Food test",
        age: 30,
        gender: "FEMALE",
        height: 170,
        weight: 70,
        workingToward: "BUILD_MUSCLE",
        experience: "INTERMEDIATE",
        daysPerWeek: "DAYS_3",
        workoutDuration: "MIN_45",
        trainingLocation: "GYM",
        equipment: ["DUMBBELLS"],
        activityLevel: "MODERATE",
        sleepDuration: "HOURS_7_TO_8",
        eatingStyle: "NO_PREFERENCE",
        limitations: ["NONE"],
        trainingDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
        trainingSplit: "FULL_BODY",
      },
    });
    const week = addDays(monday, 7),
      snapshot = await loadSnapshot(user, week, "UTC");
    const workouts = Array.from({ length: 7 }, (_, n) => ({
      date: addDays(week, n),
      restDay: true,
      estimatedMinutes: 0,
    }));
    const workoutPlan = { workouts } as WeeklyPlan;
    const noModel: StructuredModel = async () => {
      throw new Error("Model must not run");
    };
    assert.equal(
      (
        await recommendMeals(
          {
            ...snapshot,
            profile: { ...snapshot.profile, nutritionMode: "ROUTINE" },
          },
          workoutPlan,
          noModel,
        )
      ).mode,
      "ROUTINE",
    );
    assert.equal(
      (
        await recommendMeals(
          {
            ...snapshot,
            profile: { ...snapshot.profile, nutritionMode: "TRACK" },
          },
          workoutPlan,
          noModel,
        )
      ).mode,
      "TRACK",
    );
    let modelCalled = false;
    const failedModel: StructuredModel = async (_schema, _system, input) => {
      modelCalled = true;
      const context = input as any;
      assert.equal(context.routineMeals.length, 7);
      assert(!context.daysToPlan[0].requestedSlots.includes("BREAKFAST"));
      assert(
        context.daysToPlan[0].remainingTargets.calories <
          context.targets.calories,
      );
      throw new Error("Temporary provider failure");
    };
    const fallback = await safeNutrition(snapshot, workoutPlan, failedModel);
    assert(modelCalled);
    assert.equal(fallback.mode, "ROUTINE");
    assert.equal(fallback.days.length, 7);
    assert.equal(fallback.days[0]!.meals[0]!.foods[0]!.servings, 1);
    const allergic = await recommendMeals(
      { ...snapshot, profile: { ...snapshot.profile, allergies: ["milk"] } },
      workoutPlan,
      noModel,
    );
    assert.equal(
      allergic.days.length,
      7,
      "AI restrictions must preserve chosen routine meals",
    );
    const fixed = (await routineMealsForWeek(user, week)).flatMap((r) =>
      slots.map((mealType) => ({ ...r, routineId: randomUUID(), mealType })),
    );
    assert.equal(
      expectedMealSlots({ ...snapshot, routineMeals: fixed }, week).length,
      0,
    );
    assert.equal(
      (
        await recommendMeals(
          { ...snapshot, routineMeals: fixed },
          workoutPlan,
          noModel,
        )
      ).mode,
      "ROUTINE",
    );
    const whey = curatedFood(wheyRow)!;
    assert(whey);
    assert(
      foodAllowed(whey, { ...snapshot.profile, eatingStyle: "VEGETARIAN" }),
    );
    assert(!foodAllowed(whey, { ...snapshot.profile, eatingStyle: "VEGAN" }));
    assert.deepEqual(portionBounds(whey), {
      minimumGrams: 15,
      maximumGrams: 40,
    });
    assert(
      snapshot.foods.length > 153,
      "Planner must use the expanded catalog",
    );
    assert(!snapshot.foods.some((f) => /flour|bran|— uncooked/i.test(f.name)));
    await deleteRoutine(user, routine.id);
    assert.equal(
      (await plannedDay(user, today)).meals.find((m) => m.key === key)!.status,
      "LOGGED",
    );
    assert.equal((await request("/meals", undefined, other)).status, 200);
    const otherMeals = (
      (await (await request("/meals", undefined, other)).json()) as any
    ).data;
    assert(!otherMeals.some((m: any) => m.id === manual.id));
    console.log(
      "Food planning: ownership, photo-free meals, portions, routines, dated replacements, idempotency, partial AI confirmations and provider fallback passed.",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    assert.deepEqual(
      await totals(),
      before,
      "All existing foods and user history must remain intact",
    );
    console.log("Existing catalog and history preserved:", before);
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
