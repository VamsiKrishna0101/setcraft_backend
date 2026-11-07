import { MealType, DayOfWeek, Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { randomUUID } from "node:crypto";
import { loadSnapshot } from "../../graphworkflow/nodes/prepare_node";
import { safeNutrition } from "../../graphworkflow/nodes/nutrition_node";
import { openaiStructured } from "../../graphworkflow/common/model";
import {aiPlanningOwner,assertAiPlanningConsent} from '../privacy/ai_consent';
import {plannerSnapshot} from '../../graphworkflow/common/measurements';
import {
  WeeklyPlan,
  addDays,
  dateInZone,
} from "../../graphworkflow/common/types";
import { weekday } from "../workout/session/session_types";
import {
  invalidateUserNutritionCache,
  invalidateMealPlanCache,
} from "./nutrition_service";
import {
  nutritionSettings,
  routineMealsForWeek,
} from "./food_planning_service";

// Food-only refresh leaves the workout week and its generation allowance alone.
export async function refreshFoodSuggestions(
  userId: string,
  weekStart: string,
  timezone: string,
) {
  await assertAiPlanningConsent(userId);
  const lock = `food_suggestions:${userId}`;
  const token = randomUUID();
  if (!(await redis.set(lock, token, { nx: true, ex: 240 })))
    throw new Error(
      "Food planning is already running. Please try again shortly.",
    );
  try {
    if (new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1)
      throw new Error("Choose a Monday for the food week.");
    const snapshot = await loadSnapshot(
      userId,
      weekStart,
      timezone,
      false,
      prisma,
      true,
    );
    if (snapshot.profile.nutritionMode !== "AI")
      throw new Error("Choose AI suggestions in Food support first.");
    const current = await prisma.weeklyPersonalPlan.findFirst({
      where: { userId, weekStart, status: "ACTIVE", synthetic: false },
      select: { payload: true },
    });
    const workouts =
      (current?.payload as any)?.workouts ??
      Array.from({ length: 7 }, (_, n) => ({
        date: addDays(weekStart, n),
        restDay: true,
        estimatedMinutes: 0,
      }));
    const nutrition = await aiPlanningOwner.run(userId,()=>safeNutrition(
      plannerSnapshot(snapshot),
      { workouts } as WeeklyPlan,
      openaiStructured,
    ));
    if (nutrition.status !== "RECOMMENDED" || nutrition.mode !== "AI")
      return nutrition;
    const today = dateInZone(timezone);
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
        const settings = await nutritionSettings(userId, tx);
        const routines = await routineMealsForWeek(userId, weekStart, tx);
        if (
          settings.mode !== "AI" ||
          JSON.stringify([...settings.mealSlots].sort()) !==
            JSON.stringify([...(snapshot.profile.mealSlots ?? [])].sort()) ||
          JSON.stringify(
            [...routines].sort((a, b) =>
              (a.date + a.routineId).localeCompare(b.date + b.routineId),
            ),
          ) !==
            JSON.stringify(
              [...(snapshot.routineMeals ?? [])].sort((a, b) =>
                (a.date + a.routineId).localeCompare(b.date + b.routineId),
              ),
            )
        ) {
          throw new Error(
            "Your food settings or routine changed while suggestions were being prepared. Refresh food suggestions again.",
          );
        }
        const plan = await tx.userMealPlan.upsert({
          where: { userId_weekLabel: { userId, weekLabel: weekStart } },
          create: { userId, weekLabel: weekStart, aiNote: nutrition.reason },
          update: { aiNote: nutrition.reason },
        });
        const existing = await tx.userMealPlanItem.findMany({
          where: { mealPlanId: plan.id },
        });
        const decisions = await tx.userMealOccurrence.findMany({
          where: {
            userId,
            date: { gte: weekStart, lte: addDays(weekStart, 6) },
          },
        });
        for (const day of nutrition.days) {
          if (day.date < today) continue;
          for (const meal of day.meals) {
            if (
              meal.routineId ||
              decisions.some(
                (d) => d.date === day.date && d.mealType === meal.mealType,
              )
            )
              continue;
            if (
              existing.some(
                (i) =>
                  i.dayOfWeek === weekday(day.date) &&
                  i.mealType === meal.mealType &&
                  (i.status !== "PENDING" || i.mealLogId),
              )
            )
              continue;
            await tx.userMealPlanItem.deleteMany({
              where: {
                mealPlanId: plan.id,
                dayOfWeek: weekday(day.date) as DayOfWeek,
                mealType: meal.mealType,
                status: "PENDING",
              },
            });
            for (const food of meal.foods) {
              const available = await tx.nutrition.findFirst({
                where: {
                  id: food.foodId,
                  userId: null,
                  isVerified: true,
                  isArchived: false,
                },
              });
              const original = snapshot.foods.find((f) => f.id === food.foodId);
              if (
                !available ||
                !food.grams ||
                !original ||
                available.servingSize !== 100 ||
                available.servingUnit !== "g" ||
                available.caloriesPerServing !== original.calories ||
                available.proteinPerServing !== original.protein ||
                available.carbsPerServing !== original.carbs ||
                available.fatPerServing !== original.fat
              )
                throw new Error(
                  "The food library changed. Refresh food suggestions again.",
                );
              await tx.userMealPlanItem.create({
                data: {
                  mealPlanId: plan.id,
                  nutritionId: food.foodId,
                  dayOfWeek: weekday(day.date) as DayOfWeek,
                  mealType: meal.mealType as MealType,
                  mealName: food.name,
                  servings: food.grams / 100,
                  targetCalories: food.nutrients.calories,
                  targetProtein: food.nutrients.protein,
                  targetCarbs: food.nutrients.carbs,
                  targetFat: food.nutrients.fat,
                },
              });
            }
          }
        }
      },
      { timeout: 20000 },
    );
    await Promise.all([
      invalidateUserNutritionCache(userId, "", "", ""),
      invalidateMealPlanCache(userId, weekStart),
    ]);
    return nutrition;
  } finally {
    if ((await redis.get(lock).catch(() => null)) === token)
      await redis.del(lock).catch(() => undefined);
  }
}
