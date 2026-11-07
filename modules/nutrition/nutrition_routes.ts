import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { requirePremium } from "../subscription/subscription_service";
import { foodPlanningRouter } from "./food_planning_routes";
import {
  handleCreateNutritionItem,
  handleGetAllNutritionItems,
  handleGetFoodCatalog,
  handleGetNutritionById,
  handleUpdateNutritionItem,
  handleDeleteNutritionItem,
  handleGetUserNutrition,
  handleLogUserMeal,
  handleUpdateMealLogStatus,
  handleDeleteUserMealLog,
  handleLogWater,
  handleGetDailyWater,
  handleGetCustomFoods,
  handleGetCustomFoodPhoto,
  handleDeleteCustomFood,
  handleCreateMealPlan,
  handleGetMealPlan,
  handleUpdateMealPlanItemStatus,
} from "./nutrition_controller";

const router = Router();
router.use(authenticate);
router.use((req, res, next) => {
  if (
    req.method !== "GET" &&
    req.method !== "DELETE" &&
    req.user?.role !== "ADMIN"
  ) {
    return void requirePremium(req, res, next);
  }
  next();
});

// ── Global Food Catalog ───────────────────────────────────────────────────────
router.get("/items", handleGetAllNutritionItems);
router.get("/catalog", handleGetFoodCatalog);
router.get("/items/:id", handleGetNutritionById);
router.post("/items", requireRole("ADMIN"), handleCreateNutritionItem);
router.patch("/items/:id", requireRole("ADMIN"), handleUpdateNutritionItem);
router.delete("/items/:id", requireRole("ADMIN"), handleDeleteNutritionItem);

// ── Daily Meal Logs ───────────────────────────────────────────────────────────
router.use("/me/food-planning", foodPlanningRouter);
router.get("/me/custom-foods/:id/photo", handleGetCustomFoodPhoto);
router.get("/me", handleGetUserNutrition); // today
router.get("/me/:day/:month/:year", handleGetUserNutrition); // specific date
router.post("/me/log", handleLogUserMeal); // manual log
router.patch("/me/log/:id/status", handleUpdateMealLogStatus); // update status
router.delete("/me/log/:id", handleDeleteUserMealLog); // remove log

// ── User Custom Foods ─────────────────────────────────────────────────────────
router.get("/me/custom-foods", handleGetCustomFoods);
router.delete("/me/custom-foods/:id", handleDeleteCustomFood);

// ── Weekly AI Meal Plans ──────────────────────────────────────────────────────
// POST body: { weekLabel, aiNote?, items: [...] }
router.post("/me/plan", handleCreateMealPlan);
// GET  ?weekLabel=2024-W40
router.get("/me/plan", handleGetMealPlan);
// PATCH body: { status: "LOGGED" | "SKIPPED", servings? }
// This is the "user taps ✓ Done / ✗ Skip" on a meal slot
router.patch("/me/plan/items/:id", handleUpdateMealPlanItemStatus);

// ── Water ─────────────────────────────────────────────────────────────────────
router.post("/water", handleLogWater);
router.get("/water", handleGetDailyWater);

export default router;
