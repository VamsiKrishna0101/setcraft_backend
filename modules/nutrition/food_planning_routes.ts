import { Router, Request, Response } from "express";
import { z } from "zod";
import { refreshFoodSuggestions } from "./food_suggestions_service";
import {
  actionSchema,
  calendarDate,
  deleteRoutine,
  listRoutines,
  listSavedMeals,
  nutritionSettings,
  plannedDay,
  routineSchema,
  saveMeal,
  saveNutritionSettings,
  savedMealSchema,
  saveRoutine,
  settingsSchema,
  actOnPlannedMeal,
} from "./food_planning_service";

export const foodPlanningRouter = Router();
const user = (r: Request) => r.user!.userId;
const param = (r: Request, key: string) => z.string().parse(r.params[key]);
const handle =
  (fn: (r: Request) => Promise<unknown>, status = 200) =>
  async (r: Request, s: Response) => {
    try {
      s.set("Cache-Control", "private, no-store")
        .status(status)
        .json({ data: await fn(r) });
    } catch (e) {
      s.status(400).json({
        error:
          e instanceof z.ZodError
            ? "Check the meal details and try again."
            : e instanceof Error
              ? e.message
              : "Could not save. Try again.",
      });
    }
  };
foodPlanningRouter.get(
  "/settings",
  handle((r) => nutritionSettings(user(r))),
);
foodPlanningRouter.post(
  "/suggest",
  handle((r) => {
    const input = z
      .object({
        weekStart: calendarDate,
        timezone: settingsSchema.shape.timezone,
      })
      .strict()
      .parse(r.body);
    return refreshFoodSuggestions(user(r), input.weekStart, input.timezone);
  }),
);
foodPlanningRouter.put(
  "/settings",
  handle((r) => saveNutritionSettings(user(r), settingsSchema.parse(r.body))),
);
foodPlanningRouter.get(
  "/meals",
  handle((r) => listSavedMeals(user(r))),
);
foodPlanningRouter.post(
  "/meals",
  handle((r) => saveMeal(user(r), savedMealSchema.parse(r.body)), 201),
);
foodPlanningRouter.get(
  "/routines",
  handle((r) => listRoutines(user(r))),
);
foodPlanningRouter.post(
  "/routines",
  handle((r) => saveRoutine(user(r), routineSchema.parse(r.body)), 201),
);
foodPlanningRouter.put(
  "/routines/:id",
  handle((r) =>
    saveRoutine(
      user(r),
      routineSchema.parse(r.body),
      z.string().uuid().parse(param(r, "id")),
    ),
  ),
);
foodPlanningRouter.delete(
  "/routines/:id",
  handle((r) =>
    deleteRoutine(user(r), z.string().uuid().parse(param(r, "id"))),
  ),
);
foodPlanningRouter.get(
  "/day/:date",
  handle((r) => plannedDay(user(r), calendarDate.parse(param(r, "date")))),
);
foodPlanningRouter.post(
  "/day/:date/action",
  handle((r) =>
    actOnPlannedMeal(
      user(r),
      calendarDate.parse(param(r, "date")),
      actionSchema.parse(r.body),
    ),
  ),
);
