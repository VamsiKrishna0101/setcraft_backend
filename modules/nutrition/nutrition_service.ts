import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { localizedFood } from "./food_catalog_service";
import { realMealWhere } from "../../utils/real_data";
import { calcTargets } from "../home/home_service";
import {
  invalidateProgress,
  progressRevision,
} from "../progress/progress_cache";
import {
  NutritionInput,
  LogMealInput,
  GetAllNutritionFilter,
  LogWaterInput,
  CreateMealPlanInput,
  UpdateMealPlanItemStatusInput,
} from "./nutrition_types";

const NUTRITION_ITEMS_CACHE_TTL = 3600; // 1 hr for catalog items
const USER_NUTRITION_CACHE_TTL = 300; // 5 min for user daily logs
const MEAL_PLAN_CACHE_TTL = 300; // 5 min for meal plans

async function invalidateNutritionCatalogCaches(id?: string) {
  const keys = await redis.keys("nutrition_items:*");
  if (keys.length) await redis.del(...keys);
  if (id) await redis.del(`nutrition_item:${id}`);
}

export async function invalidateUserNutritionCache(
  userId: string,
  day: string,
  month: string,
  year: string,
) {
  await redis
    .multi()
    .set(`progress-revision:${userId}`, `${Date.now()}-${Math.random()}`, {
      ex: 86400,
    })
    .del(`home:${userId}`)
    .exec()
    .catch(() => undefined);
}

export async function invalidateMealPlanCache(
  userId: string,
  weekLabel?: string,
) {
  const keys = await redis.keys(`mealplan:${userId}:*`);
  if (keys.length) await redis.del(...keys);
  if (weekLabel) await redis.del(`mealplan:${userId}:${weekLabel}`);
}

// ── Nutrition Catalog CRUD ────────────────────────────────────────────────────

export async function createNutritionItem(input: NutritionInput) {
  const existingByName = await prisma.nutrition.findFirst({
    where: { name: input.name, userId: null },
    select: { id: true },
  });
  if (existingByName) {
    throw new Error(`Nutrition item with name "${input.name}" already exists`);
  }

  if (input.barcode) {
    const existingByBarcode = await prisma.nutrition.findUnique({
      where: { barcode: input.barcode },
      select: { id: true },
    });
    if (existingByBarcode) {
      throw new Error(
        `Nutrition item with barcode "${input.barcode}" already exists`,
      );
    }
  }

  const item = await prisma.nutrition.create({
    data: {
      name: input.name,
      brand: input.brand ?? null,
      category: input.category,
      imageUrl: input.imageUrl ?? null,
      barcode: input.barcode ?? null,
      servingSize: input.servingSize,
      servingUnit: input.servingUnit,
      caloriesPerServing: input.caloriesPerServing,
      proteinPerServing: input.proteinPerServing,
      carbsPerServing: input.carbsPerServing,
      fatPerServing: input.fatPerServing,
      fiberPerServing: input.fiberPerServing ?? 0,
      sugarPerServing: input.sugarPerServing ?? 0,
      sodiumPerServing: input.sodiumPerServing ?? 0,
      mealTypes: input.mealTypes,
      isVerified: input.isVerified ?? false,
    },
  });

  await invalidateNutritionCatalogCaches();
  return item;
}

export async function getAllNutritionItems(
  filters: GetAllNutritionFilter = {},
) {
  const cacheKey = `nutrition_items:generic-300-v1:${JSON.stringify(filters)}`;
  const cached = await redis.get<any[]>(cacheKey).catch(() => null);
  if (cached) return cached;

  const where: Record<string, unknown> = { userId: null, isArchived: false }; // global catalog only
  if (filters.category) where.category = filters.category;
  if (filters.barcode) where.barcode = filters.barcode;
  if (filters.mealType) where.mealTypes = { has: filters.mealType };
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { brand: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const items = await prisma.nutrition.findMany({
    where,
    orderBy: { name: "asc" },
    omit: { photoData: true, photoMime: true },
  });

  const visible = items.map((item) => localizedFood(item, "en"));
  await redis.set(cacheKey, visible, { ex: NUTRITION_ITEMS_CACHE_TTL });
  return visible;
}

export async function getNutritionById(id: string, userId?: string) {
  const cacheKey = `nutrition_item:${id}`;
  const cached = await redis.get<any>(cacheKey).catch(() => null);
  if (cached && (!cached.userId || cached.userId === userId))
    return localizedFood(cached, "en");

  const item = await prisma.nutrition.findUnique({
    where: { id },
    omit: { photoData: true, photoMime: true },
  });
  if (!item) throw new Error("Nutrition item not found");
  if (item.userId && item.userId !== userId)
    throw new Error("Nutrition item not found");

  await redis.set(cacheKey, item, { ex: NUTRITION_ITEMS_CACHE_TTL });
  return localizedFood(item, "en");
}

export async function updateNutritionItem(
  id: string,
  input: Partial<NutritionInput>,
) {
  const item = await prisma.nutrition.update({ where: { id }, data: input });
  await invalidateNutritionCatalogCaches(id);
  return item;
}

export async function deleteNutritionItem(id: string) {
  await prisma.nutrition.delete({ where: { id } });
  await invalidateNutritionCatalogCaches(id);
  return { message: "Nutrition item deleted successfully" };
}

// ── User Custom Foods ─────────────────────────────────────────────────────────

export async function getUserCustomFoods(userId: string) {
  return prisma.nutrition.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "desc" },
    omit: { photoData: true, photoMime: true },
  });
}

export async function deleteUserCustomFood(userId: string, id: string) {
  const food = await prisma.nutrition.findFirst({ where: { id, userId } });
  if (!food) throw new Error("Custom food not found or unauthorized");
  await prisma.nutrition.update({
    where: { id },
    data: {
      isArchived: true,
      photoData: null,
      photoMime: null,
      imageUrl: null,
    },
  });
  await invalidateUserNutritionCache(userId, "", "", "");
  await redis.del("nutrition_item:" + id).catch(() => undefined);
  return { message: "Custom food deleted" };
}

// Only small, private thumbnails are accepted. They never enter public URLs or
// catalogue responses; the owner-only photo route returns the bytes separately.
function decodeFoodPhoto(photo?: { mimeType: string; base64: string }) {
  if (!photo) return null;
  const bytes = Buffer.from(photo.base64, "base64");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    bytes.length < 16 ||
    bytes.length > 180000 ||
    (photo.mimeType === "image/png" ? !png : !jpeg)
  ) {
    throw new Error("Please choose a smaller JPG or PNG photo.");
  }
  if (
    png &&
    (bytes.length < 24 ||
      bytes.readUInt32BE(16) > 2048 ||
      bytes.readUInt32BE(20) > 2048)
  ) {
    throw new Error("Please choose a smaller photo.");
  }
  return { bytes, mimeType: photo.mimeType };
}

export async function getCustomFoodPhoto(userId: string, foodId: string) {
  return prisma.nutrition.findFirst({
    where: { id: foodId, userId, isArchived: false, photoData: { not: null } },
    select: { photoData: true, photoMime: true },
  });
}

// ── Daily Nutrition (logs + targets + water) ─────────────────────────────────

export interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalFiber: number;
  totalSugar: number;
}

export interface UserNutritionResult {
  logs: any[];
  dailySummary: DailySummary;
  targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    water: number;
  };
  waterConsumed: number;
}

export async function getUserNutritionItems(
  userId: string,
  day: string,
  month: string,
  year: string,
): Promise<UserNutritionResult> {
  const revision = await progressRevision(userId);
  const cacheKey = `usernutrition:${userId}:${day}:${month}:${year}:real-v2:${revision}`;
  const cached = await redis
    .get<UserNutritionResult>(cacheKey)
    .catch(() => null);
  if (cached) return cached;

  const logSelect = {
    id: true,
    mealType: true,
    servings: true,
    calories: true,
    protein: true,
    carbs: true,
    fat: true,
    fiber: true,
    sugar: true,
    status: true,
    day: true,
    month: true,
    year: true,
    createdAt: true,
    // Include the meal plan item it came from if any
    mealPlanItem: {
      select: {
        id: true,
        mealName: true,
        dayOfWeek: true,
        mealType: true,
        targetCalories: true,
        targetProtein: true,
        targetCarbs: true,
        targetFat: true,
      },
    },
    nutrition: {
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        imageUrl: true,
        servingSize: true,
        servingUnit: true,
        caloriesPerServing: true,
        proteinPerServing: true,
        carbsPerServing: true,
        fatPerServing: true,
      },
    },
  };

  const logs = await prisma.userMealLog.findMany({
    where: {
      userId,
      day: { in: [String(Number(day)), day.padStart(2, "0")] },
      month: { in: [String(Number(month)), month.padStart(2, "0")] },
      year,
      ...realMealWhere,
    },
    orderBy: { createdAt: "asc" },
    select: logSelect,
  });

  const dailySummary = logs
    .filter((log) => log.status === "LOGGED")
    .reduce(
      (acc, log) => {
        acc.totalCalories += log.calories;
        acc.totalProtein += log.protein;
        acc.totalCarbs += log.carbs;
        acc.totalFat += log.fat;
        acc.totalFiber += log.fiber;
        acc.totalSugar += log.sugar;
        return acc;
      },
      {
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        totalFiber: 0,
        totalSugar: 0,
      },
    );

  dailySummary.totalCalories = Math.round(dailySummary.totalCalories * 10) / 10;
  dailySummary.totalProtein = Math.round(dailySummary.totalProtein * 10) / 10;
  dailySummary.totalCarbs = Math.round(dailySummary.totalCarbs * 10) / 10;
  dailySummary.totalFat = Math.round(dailySummary.totalFat * 10) / 10;
  dailySummary.totalFiber = Math.round(dailySummary.totalFiber * 10) / 10;
  dailySummary.totalSugar = Math.round(dailySummary.totalSugar * 10) / 10;

  const waterAgg = await prisma.userWaterLog.aggregate({
    where: {
      userId,
      day: { in: [String(Number(day)), day.padStart(2, "0")] },
      month: { in: [String(Number(month)), month.padStart(2, "0")] },
      year,
      sourceProvider: "USER",
    },
    _sum: { amountMl: true },
  });
  const waterConsumed = waterAgg._sum.amountMl ?? 0;

  const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
  const calculated = onboarding ? calcTargets(onboarding) : null;
  const targets = {
    calories: calculated?.targetCalories ?? 0,
    protein: calculated?.targetProtein ?? 0,
    carbs: calculated?.targetCarbs ?? 0,
    fat: calculated?.targetFat ?? 0,
    water: onboarding?.weight != null ? Math.round(onboarding.weight * 35) : 0,
  };

  const result: UserNutritionResult = {
    logs,
    dailySummary,
    targets,
    waterConsumed,
  };
  await redis
    .set(cacheKey, result, { ex: USER_NUTRITION_CACHE_TTL })
    .catch(() => undefined);
  return result;
}

// ── Log a meal (direct log, not from plan) ────────────────────────────────────

export async function logUserMeal(userId: string, input: LogMealInput) {
  let nutritionId = input.nutritionId;

  // Create a private custom food if caller sent raw macros
  if (!nutritionId && input.customFood) {
    const custom = input.customFood;
    const existing = await prisma.nutrition.findFirst({
      where: {
        name: custom.name,
        userId,
        isArchived: false,
        category: custom.category ?? "PROTEIN_SOURCE",
        servingSize: custom.servingSize ?? 100,
        servingUnit: custom.servingUnit ?? "g",
        caloriesPerServing: custom.calories,
        proteinPerServing: custom.protein,
        carbsPerServing: custom.carbs,
        fatPerServing: custom.fat,
        fiberPerServing: custom.fiber ?? 0,
      },
      select: { id: true },
    });
    if (existing && !custom.photo) {
      nutritionId = existing.id;
    } else {
      const photo = decodeFoodPhoto(custom.photo);
      const created = await prisma.nutrition.create({
        data: {
          ...(photo
            ? {
                photoData: new Uint8Array(photo.bytes),
                photoMime: photo.mimeType,
              }
            : {}),
          userId, // private to this user
          name: custom.name,
          category: custom.category ?? "PROTEIN_SOURCE",
          servingSize: custom.servingSize ?? 100,
          servingUnit: custom.servingUnit ?? "g",
          caloriesPerServing: custom.calories,
          proteinPerServing: custom.protein,
          carbsPerServing: custom.carbs,
          fatPerServing: custom.fat,
          fiberPerServing: custom.fiber ?? 0,
          mealTypes: [input.mealType],
          isVerified: false,
        },
        select: { id: true },
      });
      nutritionId = created.id;
      if (photo)
        await prisma.nutrition.update({
          where: { id: nutritionId },
          data: {
            imageUrl: `/api/nutrition/me/custom-foods/${nutritionId}/photo`,
          },
        });
    }
  }

  if (!nutritionId)
    throw new Error("Nutrition item or custom food details required");

  const nutrition = await prisma.nutrition.findUnique({
    where: { id: nutritionId },
    omit: { photoData: true, photoMime: true },
  });
  if (!nutrition || nutrition.isArchived)
    throw new Error(
      "This food is no longer available. Please choose a food from the everyday library.",
    );
  if (nutrition.userId && nutrition.userId !== userId)
    throw new Error("Nutrition item not found");

  const s = input.servings;
  const round = (v: number) => Math.round(v * s * 10) / 10;

  const mealLog = await prisma.userMealLog.create({
    data: {
      userId,
      nutritionId,
      mealType: input.mealType,
      servings: s,
      calories: round(nutrition.caloriesPerServing),
      protein: round(nutrition.proteinPerServing),
      carbs: round(nutrition.carbsPerServing),
      fat: round(nutrition.fatPerServing),
      fiber: round(nutrition.fiberPerServing),
      sugar: round(nutrition.sugarPerServing),
      status: input.status ?? "LOGGED",
      day: String(Number(input.day)),
      month: String(Number(input.month)),
      year: input.year,
    },
    include: {
      nutrition: {
        select: {
          id: true,
          name: true,
          brand: true,
          category: true,
          imageUrl: true,
          servingSize: true,
          servingUnit: true,
        },
      },
    },
  });

  await invalidateUserNutritionCache(
    userId,
    input.day,
    input.month,
    input.year,
  );
  return mealLog;
}

export async function updateMealLogStatus(
  userId: string,
  logId: string,
  status: "LOGGED" | "PENDING" | "SKIPPED",
) {
  const log = await prisma.userMealLog.findFirst({
    where: { id: logId, userId },
  });
  if (!log) throw new Error("Meal log not found or unauthorized");

  const updated = await prisma.userMealLog.update({
    where: { id: logId },
    data: { status },
  });
  await invalidateUserNutritionCache(userId, log.day, log.month, log.year);
  return updated;
}

export async function deleteUserMealLog(userId: string, logId: string) {
  const log = await prisma.userMealLog.findFirst({
    where: { id: logId, userId },
  });
  if (!log) throw new Error("Meal log not found or unauthorized");

  await prisma.$transaction(async tx => {
    if (log.occurrenceId) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    await tx.userMealLog.delete({ where: { id: logId } });
    if (log.occurrenceId && !await tx.userMealLog.count({ where: { occurrenceId: log.occurrenceId } })) {
      await tx.userMealOccurrence.update({ where: { id: log.occurrenceId }, data: { status: "PENDING" } });
    }
  });
  await invalidateUserNutritionCache(userId, log.day, log.month, log.year);
  return { message: "Meal log removed successfully" };
}

// ── Meal Plan ─────────────────────────────────────────────────────────────────

/**
 * Create (or replace) the AI-generated weekly meal plan for a user.
 * If a plan already exists for the same weekLabel it is fully replaced.
 */
export async function createOrReplaceMealPlan(
  userId: string,
  input: CreateMealPlanInput,
) {
  const foodIds = [
    ...new Set(
      input.items.flatMap((item) =>
        item.nutritionId ? [item.nutritionId] : [],
      ),
    ),
  ];
  const accessible = await prisma.nutrition.count({
    where: {
      id: { in: foodIds },
      isArchived: false,
      OR: [{ userId: null }, { userId }],
    },
  });
  if (accessible !== foodIds.length)
    throw new Error("Choose foods from your library.");

  // Delete existing plan for this week if any (cascade deletes items too)
  const existing = await prisma.userMealPlan.findFirst({
    where: { userId, weekLabel: input.weekLabel },
    select: { id: true },
  });
  if (existing) {
    await prisma.userMealPlan.delete({ where: { id: existing.id } });
  }

  const plan = await prisma.userMealPlan.create({
    data: {
      userId,
      weekLabel: input.weekLabel,
      aiNote: input.aiNote ?? null,
      items: {
        create: input.items.map((item) => ({
          nutritionId: item.nutritionId ?? null,
          dayOfWeek: item.dayOfWeek,
          mealType: item.mealType,
          mealName: item.mealName,
          servings: item.servings,
          targetCalories: item.targetCalories,
          targetProtein: item.targetProtein,
          targetCarbs: item.targetCarbs,
          targetFat: item.targetFat,
          status: "PENDING",
        })),
      },
    },
    include: {
      items: {
        include: {
          nutrition: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              caloriesPerServing: true,
            },
          },
        },
        orderBy: [{ dayOfWeek: "asc" }, { mealType: "asc" }],
      },
    },
  });

  await invalidateMealPlanCache(userId, input.weekLabel);
  return plan;
}

/** Get the full weekly plan with all items */
export async function getMealPlan(userId: string, weekLabel: string) {
  const cacheKey = `mealplan:${userId}:${weekLabel}`;
  const cached = await redis.get<any>(cacheKey).catch(() => null);
  if (cached) return cached;

  const plan = await prisma.userMealPlan.findFirst({
    where: { userId, weekLabel },
    include: {
      items: {
        include: {
          nutrition: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              caloriesPerServing: true,
            },
          },
          mealLog: {
            select: {
              id: true,
              calories: true,
              protein: true,
              carbs: true,
              fat: true,
              status: true,
            },
          },
        },
        orderBy: [{ dayOfWeek: "asc" }, { mealType: "asc" }],
      },
    },
  });

  if (!plan) throw new Error("Meal plan not found for this week");

  await redis.set(cacheKey, plan, { ex: MEAL_PLAN_CACHE_TTL });
  return plan;
}

/**
 * User taps ✓ Done on a meal plan item.
 *  - Creates a UserMealLog row with actual macros.
 *  - Links the plan item to that log (mealLogId).
 *  - Sets plan item status to LOGGED.
 * User taps ✗ Skip:
 *  - Sets plan item status to SKIPPED, no log created.
 */
export async function updateMealPlanItemStatus(
  userId: string,
  itemId: string,
  input: UpdateMealPlanItemStatusInput,
) {
  // Verify the item belongs to this user
  const item = await prisma.userMealPlanItem.findFirst({
    where: { id: itemId, mealPlan: { userId } },
    include: {
      mealPlan: true,
      nutrition: true,
    },
  });
  if (!item) throw new Error("Meal plan item not found or unauthorized");

  if (input.status === "SKIPPED") {
    const updated = await prisma.userMealPlanItem.update({
      where: { id: itemId },
      data: { status: "SKIPPED", loggedAt: new Date() },
    });
    await invalidateMealPlanCache(userId, item.mealPlan.weekLabel);
    return updated;
  }

  // LOGGED — create the actual UserMealLog
  const now = new Date();
  const day = String(now.getDate());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());

  const servings = input.servings ?? item.servings;
  const nutritionId = item.nutritionId;

  let calories = item.targetCalories;
  let protein = item.targetProtein;
  let carbs = item.targetCarbs;
  let fat = item.targetFat;
  let fiber = 0;
  let sugar = 0;

  // If we have a real nutrition item, recalculate actual macros from servings
  if (item.nutrition) {
    const n = item.nutrition;
    const round = (v: number) => Math.round(v * servings * 10) / 10;
    calories = round(n.caloriesPerServing);
    protein = round(n.proteinPerServing);
    carbs = round(n.carbsPerServing);
    fat = round(n.fatPerServing);
    fiber = round(n.fiberPerServing);
    sugar = round(n.sugarPerServing);
  }

  // Create log + link plan item in a transaction
  const [mealLog] = await prisma.$transaction([
    prisma.userMealLog.create({
      data: {
        userId,
        nutritionId:
          nutritionId ?? (await ensurePlaceholderNutrition(item.mealName)),
        mealType: item.mealType,
        servings,
        calories,
        protein,
        carbs,
        fat,
        fiber,
        sugar,
        status: "LOGGED",
        day,
        month,
        year,
      },
    }),
  ]);

  // Link the new log to the plan item and mark it done
  await prisma.userMealPlanItem.update({
    where: { id: itemId },
    data: { status: "LOGGED", loggedAt: now, mealLogId: mealLog.id },
  });

  await invalidateMealPlanCache(userId, item.mealPlan.weekLabel);
  await invalidateUserNutritionCache(userId, day, month, year);

  return { mealLog, message: "Meal marked as logged" };
}

/**
 * Ensures a placeholder Nutrition row exists for AI-named meals that
 * have no nutritionId (e.g. "Grilled Chicken Wrap"). This keeps the
 * UserMealLog.nutritionId NOT NULL constraint satisfied.
 */
async function ensurePlaceholderNutrition(mealName: string): Promise<string> {
  const existing = await prisma.nutrition.findFirst({
    where: { name: mealName, userId: null, isArchived: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.nutrition.create({
    data: {
      name: mealName,
      isArchived: true,
      category: "PROTEIN_SOURCE",
      servingSize: 1,
      servingUnit: "serving",
      caloriesPerServing: 0,
      proteinPerServing: 0,
      carbsPerServing: 0,
      fatPerServing: 0,
      mealTypes: ["LUNCH"],
      isVerified: false,
    },
    select: { id: true },
  });
  return created.id;
}

// ── Water Logging ─────────────────────────────────────────────────────────────

export async function logWater(userId: string, input: LogWaterInput) {
  const log = await prisma.userWaterLog.create({
    data: {
      userId,
      amountMl: input.amountMl,
      day: String(Number(input.day)),
      month: String(Number(input.month)),
      year: input.year,
    },
  });
  await invalidateUserNutritionCache(
    userId,
    input.day,
    input.month,
    input.year,
  );
  return log;
}

export async function getDailyWater(
  userId: string,
  day: string,
  month: string,
  year: string,
) {
  const revision = await progressRevision(userId);
  const cacheKey = `nutrition:water:${userId}:${day}:${month}:${year}:real-v2:${revision}`;
  const cached = await redis.get<any>(cacheKey).catch(() => null);
  if (cached) return cached;

  const logs = await prisma.userWaterLog.findMany({
    where: {
      userId,
      day: { in: [String(Number(day)), day.padStart(2, "0")] },
      month: { in: [String(Number(month)), month.padStart(2, "0")] },
      year,
      sourceProvider: "USER",
    },
    orderBy: { createdAt: "asc" },
  });

  const totalMl = logs.reduce((sum, item) => sum + item.amountMl, 0);
  const onboarding = await prisma.onboarding.findUnique({
    where: { userId },
    select: { weight: true },
  });
  const result = {
    totalMl,
    targetMl: onboarding?.weight != null ? Math.round(onboarding.weight * 35) : 0,
    logs,
  };

  await redis.set(cacheKey, result, { ex: 3600 }).catch(() => undefined);
  return result;
}
