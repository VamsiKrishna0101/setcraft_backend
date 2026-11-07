import { DayOfWeek, MealType, Nutrition, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../../config/prisma";
import { localizedFood } from "./food_catalog_service";
import { invalidateUserNutritionCache } from "./nutrition_service";
import { addDays, dateInZone } from "../../graphworkflow/common/types";
import { weekday } from "../workout/session/session_types";

export const slots = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid calendar date");
const amount = z.number().positive().max(100);
export const settingsSchema = z
  .object({
    mode: z.enum(["ROUTINE", "AI", "TRACK"]),
    mealSlots: z
      .array(z.enum(slots))
      .min(1)
      .max(4)
      .refine((a) => new Set(a).size === a.length),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
const macro = z.number().nonnegative().max(100000);
export const savedMealSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    components: z
      .array(
        z.object({ nutritionId: z.string().uuid(), servings: amount }).strict(),
      )
      .min(1)
      .max(20)
      .optional(),
    manual: z
      .object({
        calories: macro,
        protein: macro,
        carbs: macro,
        fat: macro,
        fiber: macro.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.components) !== Boolean(v.manual),
    "Choose foods or enter nutrition values",
  );
export const routineSchema = z
  .object({
    nutritionId: z.string().uuid(),
    mealType: z.enum(slots),
    days: z
      .array(z.enum(DayOfWeek))
      .min(1)
      .max(7)
      .refine((a) => new Set(a).size === a.length),
    servings: amount,
    startsOn: calendarDate,
    paused: z.boolean().default(false),
  })
  .strict();
export const actionSchema = z
  .object({
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
    sourceKey: z
      .string()
      .regex(
        /^(routine:[0-9a-f-]{36}|plan:[0-9a-f-]{36}:(BREAKFAST|LUNCH|DINNER|SNACK))$/,
      ),
    action: z.enum(["LOGGED", "SKIPPED", "REPLACE", "RESET"]),
    replacement: z
      .object({ nutritionId: z.string().uuid(), servings: amount })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => (v.action === "REPLACE") === Boolean(v.replacement),
    "Choose a replacement meal",
  );

type Db = Prisma.TransactionClient;
export type MealEntry = {
  nutritionId: string;
  name: string;
  servings: number;
  servingSize: number;
  servingUnit: string;
  imageUrl: string | null;
  planItemId?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodiumMg: number;
};
export type PlannedMeal = {
  key: string;
  mealType: string;
  name: string;
  source: "ROUTINE" | "AI";
  entries: MealEntry[];
  status: string;
  changedToday?: boolean;
};
const round = (n: number) => Math.round(n * 10) / 10;
export function mealEntry(
  food: Nutrition,
  servings: number,
  planItemId?: string,
): MealEntry {
  return {
    nutritionId: food.id,
    name: food.name,
    servings,
    servingSize: food.servingSize,
    servingUnit: food.servingUnit,
    imageUrl: food.imageUrl,
    ...(planItemId ? { planItemId } : {}),
    calories: round(food.caloriesPerServing * servings),
    protein: round(food.proteinPerServing * servings),
    carbs: round(food.carbsPerServing * servings),
    fat: round(food.fatPerServing * servings),
    fiber: round(food.fiberPerServing * servings),
    sugar: round(food.sugarPerServing * servings),
    sodiumMg: round(food.sodiumPerServing * servings),
  };
}
function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export async function nutritionSettings(userId: string, db: Db = prisma) {
  return (
    (await db.userNutritionSettings.findUnique({ where: { userId } })) ?? {
      userId,
      mode: "ROUTINE",
      mealSlots: [...slots] as MealType[],
      timezone: "UTC",
    }
  );
}
async function invalidate(userId: string) {
  await invalidateUserNutritionCache(userId, "", "", "");
}
export async function saveNutritionSettings(
  userId: string,
  input: z.infer<typeof settingsSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    return tx.userNutritionSettings.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  });
  await invalidate(userId);
  return result;
}
async function availableFood(userId: string, id: string, db: Db = prisma) {
  const food = await db.nutrition.findFirst({
    where: {
      id,
      isArchived: false,
      OR: [{ userId }, { userId: null, isVerified: true }],
    },
  });
  if (!food)
    throw new Error("Choose an available food or one of your saved meals.");
  return food;
}
export async function listSavedMeals(userId: string) {
  const foods = await prisma.nutrition.findMany({
    where: { userId, category: "MEAL", isArchived: false },
    omit: { photoData: true, photoMime: true },
    orderBy: { updatedAt: "desc" },
  });
  return foods.map((f) => ({
    ...localizedFood(f, "en"),
    components: (f.sourceDetails as any)?.components ?? [],
  }));
}
export async function saveMeal(
  userId: string,
  input: z.infer<typeof savedMealSchema>,
) {
  const components: MealEntry[] = [];
  for (const item of input.components ?? [])
    components.push(
      mealEntry(await availableFood(userId, item.nutritionId), item.servings),
    );
  const total = (
    key: keyof Pick<
      MealEntry,
      "calories" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "sodiumMg"
    >,
  ) => round(components.reduce((n, f) => n + f[key], 0));
  const food = await prisma.nutrition.create({
    data: {
      userId,
      name: input.name,
      category: "MEAL",
      servingSize: 1,
      servingUnit: "portion",
      mealTypes: [...slots],
      caloriesPerServing: input.manual?.calories ?? total("calories"),
      proteinPerServing: input.manual?.protein ?? total("protein"),
      carbsPerServing: input.manual?.carbs ?? total("carbs"),
      fatPerServing: input.manual?.fat ?? total("fat"),
      fiberPerServing: input.manual?.fiber ?? total("fiber"),
      sugarPerServing: total("sugar"),
      sodiumPerServing: total("sodiumMg"),
      sourceDetails: json({
        kind: "SAVED_MEAL",
        components,
        defaultPortionUnit: "portion",
        nutritionSource: input.manual ? "USER_ENTERED" : "FOOD_PORTIONS",
        fiberKnown: !input.manual || input.manual.fiber !== undefined,
      }),
    },
  });
  await invalidate(userId);
  return localizedFood(food, "en");
}
export async function listRoutines(userId: string) {
  const routines = await prisma.userMealRoutine.findMany({
    where: { userId },
    include: { nutrition: { omit: { photoData: true, photoMime: true } } },
    orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
  });
  return routines.map((r) => ({
    ...r,
    nutrition: localizedFood(r.nutrition, "en"),
  }));
}
export async function saveRoutine(
  userId: string,
  input: z.infer<typeof routineSchema>,
  id?: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    await availableFood(userId, input.nutritionId, tx);
    if (id && !(await tx.userMealRoutine.findFirst({ where: { id, userId } })))
      throw new Error("Routine not found.");
    // One routine per meal slot/day keeps the plan unambiguous.
    const overlapping = await tx.userMealRoutine.findFirst({
      where: {
        userId,
        ...(id ? { id: { not: id } } : {}),
        paused: false,
        mealType: input.mealType,
        days: { hasSome: input.days },
      },
    });
    if (!input.paused && overlapping)
      throw new Error(
        "A routine already uses this meal slot on one of these days. Edit it or choose different days.",
      );
    // Saving an active routine is an explicit choice to use planned meals.
    // Keep AI enabled when selected, and make routines visible for manual users.
    if (!input.paused)
      await tx.userNutritionSettings.updateMany({
        where: { userId, mode: "TRACK" },
        data: { mode: "ROUTINE" },
      });
    return id
      ? tx.userMealRoutine.update({ where: { id }, data: input })
      : tx.userMealRoutine.create({ data: { userId, ...input } });
  });
  await invalidate(userId);
  return result;
}
export async function deleteRoutine(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    await tx.userMealRoutine.deleteMany({ where: { id, userId } });
  });
  await invalidate(userId);
}

export async function routineMealsForWeek(
  userId: string,
  weekStart: string,
  db: Db = prisma,
) {
  const routines = await db.userMealRoutine.findMany({
    where: {
      userId,
      paused: false,
      startsOn: { lte: addDays(weekStart, 6) },
      nutrition: { isArchived: false },
    },
    include: { nutrition: true },
  });
  return Array.from({ length: 7 }, (_, n) => addDays(weekStart, n)).flatMap(
    (date) =>
      routines
        .filter(
          (r) =>
            r.startsOn <= date && r.days.includes(weekday(date) as DayOfWeek),
        )
        .map((r) => ({
          routineId: r.id,
          date,
          mealType: r.mealType as (typeof slots)[number],
          entry: mealEntry(r.nutrition, r.servings),
        })),
  );
}
export async function plannedDay(
  userId: string,
  date: string,
  db: Db = prisma,
) {
  const settings = await nutritionSettings(userId, db);
  const routines =
    settings.mode === "TRACK"
      ? []
      : (await routineMealsForWeek(userId, date, db)).filter(
          (r) => r.date === date,
        );
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = addDays(date, -(day + 6) % 7);
  const plan =
    settings.mode === "AI"
      ? await db.userMealPlan.findUnique({
          where: { userId_weekLabel: { userId, weekLabel: monday } },
          include: {
            items: {
              where: { dayOfWeek: weekday(date) as DayOfWeek },
              include: { nutrition: true },
            },
          },
        })
      : null;
  const meals: PlannedMeal[] = routines.map((r) => ({
    key: `routine:${r.routineId}`,
    mealType: r.mealType,
    name: r.entry.name,
    source: "ROUTINE",
    entries: [r.entry],
    status: "PENDING",
  }));
  for (const slot of settings.mealSlots) {
    if (meals.some((m) => m.mealType === slot)) continue;
    const items =
      plan?.items.filter(
        (i) => i.mealType === slot && i.nutrition && !i.nutrition.isArchived,
      ) ?? [];
    if (!items.length) continue;
    const pending = items.filter((i) => i.status === "PENDING");
    meals.push({
      key: `plan:${plan!.id}:${slot}`,
      mealType: slot,
      name: slot.charAt(0) + slot.slice(1).toLowerCase(),
      source: "AI",
      entries: (pending.length ? pending : items).map((i) =>
        mealEntry(i.nutrition!, i.servings, i.id),
      ),
      status: pending.length
        ? "PENDING"
        : items.every((i) => i.status === "SKIPPED")
          ? "SKIPPED"
          : "LOGGED",
    });
  }
  const decisions = await db.userMealOccurrence.findMany({
    where: { userId, date },
  });
  for (const decision of decisions) {
    // Keep dated decisions visible after a routine is changed, paused or removed.
    if (!meals.some((m) => m.key === decision.sourceKey)) {
      const entries = decision.entries as unknown as MealEntry[];
      meals.push({
        key: decision.sourceKey,
        mealType: decision.mealType,
        name:
          entries.length === 1
            ? entries[0]!.name
            : decision.mealType.toLowerCase(),
        source: decision.sourceKey.startsWith("routine:") ? "ROUTINE" : "AI",
        entries,
        status: decision.status,
        changedToday: true,
      });
    }
  }
  for (const meal of meals) {
    const decision = decisions.find((d) => d.sourceKey === meal.key);
    if (decision) {
      meal.mealType = decision.mealType;
      meal.status = decision.status;
      meal.entries = decision.entries as unknown as MealEntry[];
      meal.changedToday = true;
      meal.name = meal.entries.length === 1 ? meal.entries[0]!.name : meal.name;
    }
  }
  return { date, settings, meals };
}

export async function actOnPlannedMeal(
  userId: string,
  date: string,
  input: z.infer<typeof actionSchema>,
) {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      const current = await plannedDay(userId, date, tx);
      if (
        input.action === "LOGGED" &&
        date > dateInZone(input.timezone ?? current.settings.timezone)
      )
        throw new Error("Confirm food on the day you eat it.");
      const previous = await tx.userMealOccurrence.findUnique({
        where: {
          userId_date_sourceKey: { userId, date, sourceKey: input.sourceKey },
        },
        include: { logs: true },
      });
      if (previous?.status === "LOGGED") {
        if (input.action === "LOGGED") return previous;
        throw new Error(
          "This meal is already logged. Remove its diary entry before changing it.",
        );
      }
      const meal = current.meals.find((m) => m.key === input.sourceKey);
      if (!meal)
        throw new Error(
          "This planned meal is no longer available. Refresh your day.",
        );
      if (!previous && meal.status === "LOGGED") {
        if (input.action === "LOGGED") return { status: "LOGGED" };
        throw new Error(
          "This meal is already logged. Remove its diary entry before changing it.",
        );
      }
      if (input.action === "RESET") {
        if (previous)
          await tx.userMealOccurrence.delete({ where: { id: previous.id } });
        return { status: "PENDING" };
      }
      let entries = meal.entries;
      if (input.replacement)
        entries = [
          mealEntry(
            await availableFood(userId, input.replacement.nutritionId, tx),
            input.replacement.servings,
          ),
        ];
      const status = input.action === "REPLACE" ? "PENDING" : input.action;
      const occurrence = await tx.userMealOccurrence.upsert({
        where: {
          userId_date_sourceKey: { userId, date, sourceKey: input.sourceKey },
        },
        create: {
          userId,
          date,
          sourceKey: input.sourceKey,
          mealType: meal.mealType as MealType,
          status,
          entries: json(entries),
        },
        update: { status, entries: json(entries) },
      });
      if (status === "LOGGED")
        for (const entry of entries) {
          // Recheck ownership/availability at confirmation; record the dated snapshot.
          await availableFood(userId, entry.nutritionId, tx);
          const { id } = await tx.userMealLog.create({
            data: {
              userId,
              occurrenceId: occurrence.id,
              nutritionId: entry.nutritionId,
              mealType: meal.mealType as MealType,
              servings: entry.servings,
              calories: entry.calories,
              protein: entry.protein,
              carbs: entry.carbs,
              fat: entry.fat,
              fiber: entry.fiber,
              sugar: entry.sugar,
              sodiumMg: entry.sodiumMg,
              day: date.slice(8),
              month: date.slice(5, 7),
              year: date.slice(0, 4),
              status: "LOGGED",
            },
          });
          if (entry.planItemId)
            await tx.userMealPlanItem.updateMany({
              where: { id: entry.planItemId, mealPlan: { userId } },
              data: { status: "LOGGED", mealLogId: id, loggedAt: new Date() },
            });
        }
      return occurrence;
    },
    { timeout: 20000 },
  );
  await invalidate(userId);
  return result;
}
