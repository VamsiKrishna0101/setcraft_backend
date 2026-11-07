import { nutritionTargets } from "../../utils/nutrition_targets";
import type { WeeklyPlan } from "./types";

type NutritionProfile = {
  weight: number | null; height: number | null; age: number; gender: string;
  activityLevel: string; goal?: string; workingToward?: string;
};

/** Daily intake estimates do not depend on meal mode or food catalog coverage. */
export function dailyNutritionTargets(profile: NutritionProfile): WeeklyPlan["nutrition"]["targets"] {
  const { weight, height, age, gender } = profile;
  if (weight == null || height == null ||
      ![weight, height, age].every(Number.isFinite) ||
      weight < 35 || weight > 250 || height < 120 || height > 230 ||
      age < 18 || age > 85 || !["MALE", "FEMALE"].includes(gender)) return null;
  const calculated = nutritionTargets({
    weight, height, age, gender, activityLevel: profile.activityLevel,
    workingToward: profile.goal ?? profile.workingToward ?? "",
  });
  const targets = {
    calories: calculated.targetCalories, protein: calculated.targetProtein,
    carbs: calculated.targetCarbs, fat: calculated.targetFat,
  };
  return Object.values(targets).every(value => Number.isFinite(value) && value > 0) &&
    targets.calories >= 1200 && targets.calories <= 4500 ? targets : null;
}
