import { Request, Response, NextFunction } from "express";
import { appLocale } from "../../utils/app_locale";
import { NutritionCategory, MealType } from "@prisma/client";
import { getFoodCatalogPage } from "./food_catalog_service";
import {
  NutritionSchema,
  LogMealSchema,
  UpdateMealLogStatusSchema,
  LogWaterSchema,
  GetWaterQuerySchema,
  CreateMealPlanSchema,
  UpdateMealPlanItemStatusSchema,
  GetWeekPlanQuerySchema,
  FoodCatalogQuerySchema,
} from "./nutrition_types";
import {
  createNutritionItem,
  getAllNutritionItems,
  getNutritionById,
  updateNutritionItem,
  deleteNutritionItem,
  getUserNutritionItems,
  logUserMeal,
  updateMealLogStatus,
  deleteUserMealLog,
  logWater,
  getDailyWater,
  getUserCustomFoods,
  getCustomFoodPhoto,
  deleteUserCustomFood,
  createOrReplaceMealPlan,
  getMealPlan,
  updateMealPlanItemStatus,
} from "./nutrition_service";

// ─── Helper ───────────────────────────────────────────────────────────────────
function resolveUserId(req: Request): string | null {
  return req.user?.userId || (req as any).user?.id || null;
}

export async function handleGetFoodCatalog(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = FoodCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    res
      .status(200)
      .json({
        data: await getFoodCatalogPage(
          userId,
          parsed.data,
          appLocale(req.headers["accept-language"]),
        ),
      });
  } catch (error) {
    next(error);
  }
}

function routeParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

// ─── POST /api/nutrition/items ────────────────────────── ADMIN only ──────────
export async function handleCreateNutritionItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = NutritionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const item = await createNutritionItem(parsed.data);
    res.status(201).json({ message: "Nutrition item created", data: item });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/nutrition/items ─────────────────────────── Authenticated ────────
export async function handleGetAllNutritionItems(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { category, search, barcode, mealType } = req.query as Record<
      string,
      string
    >;
    const items = await getAllNutritionItems({
      category: category as NutritionCategory | undefined,
      search,
      barcode,
      mealType: mealType as MealType | undefined,
    });
    res.status(200).json({ data: items });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/nutrition/items/:id ─────────────────────── Authenticated ────────
export async function handleGetNutritionById(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const item = await getNutritionById(
      routeParam(req, "id"),
      resolveUserId(req) ?? undefined,
    );
    res.status(200).json({ data: item });
  } catch (e) {
    next(e);
  }
}

// ─── PATCH /api/nutrition/items/:id ───────────────────── ADMIN only ──────────
export async function handleUpdateNutritionItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = NutritionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const item = await updateNutritionItem(routeParam(req, "id"), parsed.data);
    res.status(200).json({ message: "Nutrition item updated", data: item });
  } catch (e) {
    next(e);
  }
}

// ─── DELETE /api/nutrition/items/:id ──────────────────── ADMIN only ──────────
export async function handleDeleteNutritionItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await deleteNutritionItem(routeParam(req, "id"));
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/nutrition/me [?day&month&year] ─────────── Authenticated ────────
export async function handleGetUserNutrition(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = new Date();
  const day =
    routeParam(req, "day") ||
    (req.query.day as string) ||
    String(now.getDate());
  const month =
    routeParam(req, "month") ||
    (req.query.month as string) ||
    String(now.getMonth() + 1).padStart(2, "0");
  const year =
    routeParam(req, "year") ||
    (req.query.year as string) ||
    String(now.getFullYear());
  if (!GetWaterQuerySchema.safeParse({ day, month, year }).success) {
    res.status(400).json({ error: "Invalid calendar date." });
    return;
  }

  try {
    const data = await getUserNutritionItems(userId, day, month, year);
    res.status(200).json({ data });
  } catch (e) {
    next(e);
  }
}

// ─── POST /api/nutrition/me/log ───────────────────────── Authenticated ────────
export async function handleLogUserMeal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = LogMealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const mealLog = await logUserMeal(userId, parsed.data);
    res
      .status(201)
      .json({ message: "Meal logged successfully", data: mealLog });
  } catch (e) {
    next(e);
  }
}

// ─── DELETE /api/nutrition/me/log/:id ────────────────── Authenticated ────────
export async function handleDeleteUserMealLog(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await deleteUserMealLog(userId, routeParam(req, "id"));
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

// ─── PATCH /api/nutrition/me/log/:id/status ──────────── Authenticated ────────
export async function handleUpdateMealLogStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = UpdateMealLogStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await updateMealLogStatus(
      userId,
      routeParam(req, "id"),
      parsed.data.status,
    );
    res.status(200).json({ message: "Meal status updated", data: result });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/nutrition/me/custom-foods ──────────────── Authenticated ────────
export async function handleGetCustomFoods(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const data = await getUserCustomFoods(userId);
    res.status(200).json({ data });
  } catch (e) {
    next(e);
  }
}

// ─── DELETE /api/nutrition/me/custom-foods/:id ────────── Authenticated ────────
export async function handleDeleteCustomFood(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await deleteUserCustomFood(userId, routeParam(req, "id"));
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

// ─── POST /api/nutrition/me/plan ─────────────────────── Authenticated ────────
// AI or client sends the full week plan; replaces any existing one for that week.
export async function handleCreateMealPlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateMealPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const plan = await createOrReplaceMealPlan(userId, parsed.data);
    res.status(201).json({ message: "Meal plan created", data: plan });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/nutrition/me/plan?weekLabel=2024-W40 ───── Authenticated ────────
export async function handleGetMealPlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = GetWeekPlanQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const plan = await getMealPlan(userId, parsed.data.weekLabel);
    res.status(200).json({ data: plan });
  } catch (e) {
    next(e);
  }
}

// ─── PATCH /api/nutrition/me/plan/items/:id ──────────── Authenticated ────────
// User taps ✓ Done or ✗ Skip on a specific meal slot in their plan.
export async function handleUpdateMealPlanItemStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = UpdateMealPlanItemStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await updateMealPlanItemStatus(
      userId,
      routeParam(req, "id"),
      parsed.data,
    );
    res.status(200).json({ message: "Meal plan item updated", data: result });
  } catch (e) {
    next(e);
  }
}

// ─── Water ────────────────────────────────────────────────────────────────────

export async function handleLogWater(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = LogWaterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const data = await logWater(userId, parsed.data);
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
}

export async function handleGetDailyWater(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = GetWaterQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const data = await getDailyWater(
      userId,
      parsed.data.day,
      parsed.data.month,
      parsed.data.year,
    );
    res.status(200).json({ data });
  } catch (e) {
    next(e);
  }
}

export async function handleGetCustomFoodPhoto(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const photo = await getCustomFoodPhoto(
      req.user!.userId,
      routeParam(req, "id"),
    );
    if (!photo?.photoData || !photo.photoMime) {
      res.sendStatus(404);
      return;
    }
    res
      .set({
        "Content-Type": photo.photoMime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(photo.photoData));
  } catch (error) {
    next(error);
  }
}
