import { z } from "zod";
import { NutritionCategory, MealType, DayOfWeek } from "@prisma/client";

export const NutritionSchema = z.object({
  name: z.string().min(2).max(100),
  brand: z.string().max(50).optional(),
  category: z.enum(NutritionCategory),
  imageUrl: z.string().url().optional(),
  barcode: z.string().min(3).max(50).optional(),

  servingSize: z.number().positive(),
  servingUnit: z.string().min(1).max(30),

  caloriesPerServing: z.number().nonnegative(),
  proteinPerServing: z.number().nonnegative(),
  carbsPerServing: z.number().nonnegative(),
  fatPerServing: z.number().nonnegative(),
  fiberPerServing: z.number().nonnegative().default(0),
  sugarPerServing: z.number().nonnegative().default(0),
  sodiumPerServing: z.number().nonnegative().default(0),

  mealTypes: z.array(z.enum(MealType)).min(1),
  isVerified: z.boolean().default(false).optional(),
});

export type NutritionInput = z.infer<typeof NutritionSchema>;

export const CustomFoodSchema = z.object({
  name: z.string().min(2).max(100),
  category: z.enum(NutritionCategory).default("PROTEIN_SOURCE").optional(),
  photo: z
    .object({
      mimeType: z.enum(["image/jpeg", "image/png"]),
      base64: z
        .string()
        .min(16)
        .max(240000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .optional(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative().default(0).optional(),
  servingSize: z.number().positive().default(100).optional(),
  servingUnit: z.enum(["g", "ml", "portion"]).default("g").optional(),
});

const dateParts = {
  day: z.string().regex(/^\d{1,2}$/),
  month: z.string().regex(/^\d{1,2}$/),
  year: z.string().regex(/^\d{4}$/),
};
function validParts(value: { day: string; month: string; year: string }) {
  const iso = `${value.year}-${value.month.padStart(2, "0")}-${value.day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso
  );
}
export const LogMealSchema = z
  .object({
    nutritionId: z.string().uuid("Invalid nutritionId format").optional(),
    customFood: CustomFoodSchema.optional(),
    mealType: z.enum(MealType),
    servings: z
      .number()
      .positive("Servings must be greater than 0")
      .max(100)
      .default(1),
    status: z
      .enum(["LOGGED", "PENDING", "SKIPPED"])
      .default("LOGGED")
      .optional(),
    ...dateParts,
    // Optional link to a meal plan item that was tapped ✓
    mealPlanItemId: z.string().uuid().optional(),
  })
  .refine(validParts, "Invalid calendar date")
  .refine(
    (value) => Boolean(value.nutritionId) !== Boolean(value.customFood),
    "Choose a catalog food or a custom food.",
  );

export type LogMealInput = z.infer<typeof LogMealSchema>;

export const UpdateMealLogStatusSchema = z.object({
  status: z.enum(["LOGGED", "PENDING", "SKIPPED"]),
});

export type UpdateMealLogStatusInput = z.infer<
  typeof UpdateMealLogStatusSchema
>;

export interface GetAllNutritionFilter {
  category?: NutritionCategory;
  search?: string;
  barcode?: string;
  mealType?: MealType;
}

export const FoodCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  search: z.string().trim().max(120).default(""),
  category: z.enum(NutritionCategory).optional(),
  focus: z.enum(["ALL", "PROTEIN", "FIBRE", "LIGHTER"]).default("ALL"),
  sort: z.enum(["NAME", "PROTEIN", "CALORIES"]).default("NAME"),
  source: z
    .enum(["LIBRARY", "RECENT", "MY_FOODS", "MY_MEALS"])
    .default("LIBRARY"),
});
export type FoodCatalogQuery = z.infer<typeof FoodCatalogQuerySchema>;

export const LogWaterSchema = z
  .object({
    amountMl: z.number().int().positive().max(5000),
    ...dateParts,
  })
  .refine(validParts, "Invalid calendar date");

export type LogWaterInput = z.infer<typeof LogWaterSchema>;

export const GetWaterQuerySchema = z
  .object(dateParts)
  .refine(validParts, "Invalid calendar date");

export type GetWaterQueryInput = z.infer<typeof GetWaterQuerySchema>;

// ── Meal Plan Types ────────────────────────────────────────────────────────────

// Each item inside the plan generation request (used when AI creates a week plan)
export const MealPlanItemInputSchema = z.object({
  nutritionId: z.string().uuid().optional(), // optional: AI may suggest by name only
  dayOfWeek: z.enum(DayOfWeek),
  mealType: z.enum(MealType),
  mealName: z.string().min(2).max(150),
  servings: z.number().positive().default(1),
  targetCalories: z.number().nonnegative(),
  targetProtein: z.number().nonnegative(),
  targetCarbs: z.number().nonnegative(),
  targetFat: z.number().nonnegative(),
});

export const CreateMealPlanSchema = z.object({
  weekLabel: z.string().min(6).max(10), // e.g. "2024-W40"
  aiNote: z.string().max(1000).optional(),
  items: z.array(MealPlanItemInputSchema).min(1).max(50),
});

export type CreateMealPlanInput = z.infer<typeof CreateMealPlanSchema>;

// Mark a plan item as LOGGED or SKIPPED
export const UpdateMealPlanItemStatusSchema = z.object({
  status: z.enum(["LOGGED", "SKIPPED"]),
  // When logging, optional servings override
  servings: z.number().positive().optional(),
});

export type UpdateMealPlanItemStatusInput = z.infer<
  typeof UpdateMealPlanItemStatusSchema
>;

export const GetWeekPlanQuerySchema = z.object({
  weekLabel: z.string().min(6).max(10),
});

export type GetWeekPlanQueryInput = z.infer<typeof GetWeekPlanQuerySchema>;
