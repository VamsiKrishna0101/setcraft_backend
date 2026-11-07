// Conservative product starting estimates; observed intake/weight trends need review.
export function nutritionTargets(profile: {weight: number; height: number; age: number; gender: string;
  activityLevel: string; workingToward: string}) {
  const {weight, height, age, gender, activityLevel, workingToward} = profile;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === 'FEMALE' ? -161 : 5);
  const multiplier: Record<string, number> = {LOW: 1.375, MODERATE: 1.55, HIGH: 1.725};
  const maintenance = bmr * (multiplier[activityLevel] ?? 1.55);
  const fatLoss = ['LOSE_BODY_FAT', 'LOSE_WEIGHT'].includes(workingToward);
  const adjustment = fatLoss ? -Math.min(450, maintenance * .15)
    : workingToward === 'BUILD_MUSCLE' ? Math.min(250, maintenance * .08) : 0;
  const floor = gender === 'FEMALE' ? 1400 : 1600;
  const targetCalories = Math.round(Math.max(floor, maintenance + adjustment));
  const targetProtein = Math.round(Math.min(weight * (fatLoss || workingToward === 'BUILD_MUSCLE' ? 1.8 : 1.6),
    targetCalories * .30 / 4));
  const targetFat = Math.round(targetCalories * .28 / 9);
  const targetCarbs = Math.max(0, Math.round((targetCalories - targetProtein * 4 - targetFat * 9) / 4));
  return {targetCalories, targetProtein, targetCarbs, targetFat};
}
