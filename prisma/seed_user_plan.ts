import prisma from "../config/prisma";
import redis from "../config/redis";
import {
  Gender,
  WorkingToward,
  Experience,
  DaysPerWeek,
  WorkoutDuration,
  TrainingLocation,
  Equipment,
  ActivityLevel,
  SleepDuration,
  EatingStyle,
  BodyLimitation,
  Difficulty,
  DayOfWeek,
  WorkStatus,
  MealType,
  NutritionCategory,
} from "@prisma/client";

type SharedNutritionItem = {
  name: string;
  category: NutritionCategory;
  servingSize: number;
  servingUnit: string;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  mealTypes: MealType[];
};

async function upsertSharedNutritionItem(data: SharedNutritionItem) {
  const existing = await prisma.nutrition.findFirst({
    where: { name: data.name, userId: null },
    select: { id: true },
  });

  if (existing) {
    return prisma.nutrition.update({ where: { id: existing.id }, data });
  }

  return prisma.nutrition.create({ data });
}

async function main() {
  const targetEmail = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
  if (!targetEmail) {
    throw new Error("Set SEED_USER_EMAIL to an existing development account.");
  }
  if (!targetEmail.endsWith('@example.invalid')) {
    throw new Error('Mock plans may only be seeded into isolated @example.invalid test accounts.');
  }
  console.log(`Starting mock data seeding for: ${targetEmail}`);

  // Never create a user with a fixed development password or overwrite an
  // existing account's credentials as a side effect of seeding.
  const user = await prisma.user.findUnique({ where: { email: targetEmail } });
  if (!user) {
    throw new Error(`No existing user found for SEED_USER_EMAIL=${targetEmail}.`);
  }
  console.log(`User confirmed: ${user.id} (${user.email})`);

  // Preserve an existing user's real onboarding answers; seed only if absent.
  await prisma.onboarding.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      name: "V",
      age: 26,
      gender: Gender.MALE,
      height: 178.0,
      weight: 76.5,
      targetWeight: 80.0,
      workingToward: WorkingToward.BUILD_MUSCLE,
      experience: Experience.INTERMEDIATE,
      daysPerWeek: DaysPerWeek.DAYS_5,
      workoutDuration: WorkoutDuration.MIN_60_PLUS,
      trainingLocation: TrainingLocation.GYM,
      equipment: [
        Equipment.DUMBBELLS,
        Equipment.BARBELLS,
        Equipment.CABLE,
        Equipment.BENCH,
        Equipment.MACHINES,
      ],
      activityLevel: ActivityLevel.HIGH,
      sleepDuration: SleepDuration.HOURS_7_TO_8,
      eatingStyle: EatingStyle.NON_VEGETARIAN,
      limitations: [BodyLimitation.NONE],
    },
  });
  console.log("Onboarding profile saved.");

  // 3. Upsert Workout Library Catalog
  const workoutCatalog = [
    {
      name: "Barbell Incline Bench Press",
      description: "Primary upper chest builder with mechanical overload.",
      category: "Chest",
      duration: 15,
      bodyPart: "Upper Chest",
      equipment: "BARBELLS",
      difficulty: Difficulty.INTERMEDIATE,
      instructions: ["Set bench to 30 degrees", "Lower barbell to clavicle with control", "Press up forcefully"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "Flat Dumbbell Press",
      description: "High stretch pectoral recruitment with neutral hand rotation.",
      category: "Chest",
      duration: 12,
      bodyPart: "Mid Chest",
      equipment: "DUMBBELLS",
      difficulty: Difficulty.INTERMEDIATE,
      instructions: ["Retract scapula on bench", "Descend with 3-second negative", "Drive dumbbells together"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "High-to-Low Cable Flyes",
      description: "Peak contraction targeting sternal pectoral fibers.",
      category: "Chest",
      duration: 10,
      bodyPart: "Lower Chest",
      equipment: "CABLE",
      difficulty: Difficulty.BEGINNER,
      instructions: ["Set pulleys high", "Squeeze downward and inward", "Pause 1 second at peak contraction"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "Overhead Rope Tricep Extension",
      description: "Long head tricep stretch under constant cable tension.",
      category: "Arms",
      duration: 10,
      bodyPart: "Triceps",
      equipment: "CABLE",
      difficulty: Difficulty.BEGINNER,
      instructions: ["Flare rope at top", "Keep elbows steady", "Controlled eccentric return"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "Hanging Leg Raises",
      description: "Anterior abdominal chain and hip flexor strengthening.",
      category: "Core",
      duration: 8,
      bodyPart: "Abs",
      equipment: "OTHER",
      difficulty: Difficulty.INTERMEDIATE,
      instructions: ["Hang from pull-up bar", "Raise toes toward bar without swinging", "Slow lower"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "Barbell Back Squat",
      description: "The gold standard compound leg developer.",
      category: "Legs",
      duration: 20,
      bodyPart: "Quads & Glutes",
      equipment: "BARBELLS",
      difficulty: Difficulty.ADVANCED,
      instructions: ["Break at hips and knees", "Squat below parallel", "Drive through midfoot"],
      trainingLocation: TrainingLocation.GYM,
    },
    {
      name: "Barbell Bent-Over Row",
      description: "Lat and mid-back thickness builder.",
      category: "Back",
      duration: 15,
      bodyPart: "Lats & Rhomboids",
      equipment: "BARBELLS",
      difficulty: Difficulty.INTERMEDIATE,
      instructions: ["Hinge at 45 degrees", "Pull bar to lower sternum", "Retract shoulder blades"],
      trainingLocation: TrainingLocation.GYM,
    },
  ];

  const workoutsMap: Record<string, string> = {};
  for (const w of workoutCatalog) {
    const item = await prisma.workout.upsert({
      where: { name: w.name },
      update: w,
      create: w,
    });
    workoutsMap[w.name] = item.id;
  }
  console.log("Workout catalog seeded.");

  // 4. Create Current User Weekly Workout Plan
  // Clean up any stale active workouts for this user to ensure pristine state
  await prisma.userWorkout.deleteMany({
    where: { userId: user.id, weekLabel: "Week 4 Hypertrophy" },
  });

  const userWorkout = await prisma.userWorkout.create({
    data: {
      userId: user.id,
      weekLabel: "Week 4 Hypertrophy",
      status: WorkStatus.IN_PROGRESS,
      aiNote: "Target Effort: 8.5/10 — Peak mechanical tension. Focus on 3-second eccentric tempo.",
      items: {
        create: [
          // Monday: Completed
          {
            workoutId: workoutsMap["Barbell Back Squat"],
            dayOfWeek: DayOfWeek.MONDAY,
            orderIndex: 0,
            targetSets: 4,
            targetReps: "6-8",
            targetRpe: 8.5,
            restSeconds: 120,
            status: WorkStatus.COMPLETED,
            completedAt: new Date(Date.now() - 2 * 86400000),
          },
          // Tuesday: Completed
          {
            workoutId: workoutsMap["Barbell Bent-Over Row"],
            dayOfWeek: DayOfWeek.TUESDAY,
            orderIndex: 0,
            targetSets: 4,
            targetReps: "8-10",
            targetRpe: 8.0,
            restSeconds: 90,
            status: WorkStatus.COMPLETED,
            completedAt: new Date(Date.now() - 1 * 86400000),
          },
          // Wednesday (TODAY): In Progress / Active
          {
            workoutId: workoutsMap["Barbell Incline Bench Press"],
            dayOfWeek: DayOfWeek.WEDNESDAY,
            orderIndex: 0,
            targetSets: 4,
            targetReps: "8-10",
            targetRpe: 8.5,
            restSeconds: 90,
            status: WorkStatus.IN_PROGRESS,
          },
          {
            workoutId: workoutsMap["Flat Dumbbell Press"],
            dayOfWeek: DayOfWeek.WEDNESDAY,
            orderIndex: 1,
            targetSets: 3,
            targetReps: "10-12",
            targetRpe: 8.0,
            restSeconds: 75,
            status: WorkStatus.NOT_STARTED,
          },
          {
            workoutId: workoutsMap["High-to-Low Cable Flyes"],
            dayOfWeek: DayOfWeek.WEDNESDAY,
            orderIndex: 2,
            targetSets: 3,
            targetReps: "12-15",
            targetRpe: 9.0,
            restSeconds: 60,
            status: WorkStatus.NOT_STARTED,
          },
          {
            workoutId: workoutsMap["Overhead Rope Tricep Extension"],
            dayOfWeek: DayOfWeek.WEDNESDAY,
            orderIndex: 3,
            targetSets: 3,
            targetReps: "12-15",
            targetRpe: 8.5,
            restSeconds: 60,
            status: WorkStatus.NOT_STARTED,
          },
          {
            workoutId: workoutsMap["Hanging Leg Raises"],
            dayOfWeek: DayOfWeek.WEDNESDAY,
            orderIndex: 4,
            targetSets: 3,
            targetReps: "15",
            targetRpe: 8.0,
            restSeconds: 60,
            status: WorkStatus.NOT_STARTED,
          },
          // Thursday: Upcoming
          {
            workoutId: workoutsMap["Barbell Bent-Over Row"],
            dayOfWeek: DayOfWeek.THURSDAY,
            orderIndex: 0,
            targetSets: 4,
            targetReps: "8-10",
            targetRpe: 8.0,
            restSeconds: 90,
            status: WorkStatus.NOT_STARTED,
          },
          // Friday: Upcoming
          {
            workoutId: workoutsMap["Barbell Back Squat"],
            dayOfWeek: DayOfWeek.FRIDAY,
            orderIndex: 0,
            targetSets: 4,
            targetReps: "8-10",
            targetRpe: 8.5,
            restSeconds: 120,
            status: WorkStatus.NOT_STARTED,
          },
          // Saturday: Rest
          {
            workoutId: workoutsMap["Hanging Leg Raises"],
            dayOfWeek: DayOfWeek.SATURDAY,
            orderIndex: 0,
            targetSets: 3,
            targetReps: "10",
            status: WorkStatus.REST_DAY,
          },
          // Sunday: Rest
          {
            workoutId: workoutsMap["Hanging Leg Raises"],
            dayOfWeek: DayOfWeek.SUNDAY,
            orderIndex: 0,
            targetSets: 3,
            targetReps: "10",
            status: WorkStatus.REST_DAY,
          },
        ],
      },
    },
    include: { items: true },
  });
  console.log(`Weekly workout plan seeded with ${userWorkout.items.length} sessions.`);

  // 5. Seed Past Set Logs (Establishing a 7-day streak)
  const now = new Date();
  const dayStr = String(now.getDate());
  const monthStr = String(now.getMonth() + 1);
  const yearStr = String(now.getFullYear());
  const todayIso = `${yearStr}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`;

  // 6. Upsert HealthKit Biometric Snapshot for Today
  await prisma.healthKitSnapshot.upsert({
    where: { userId_date: { userId: user.id, date: todayIso } },
    update: {
      recoveryScore: 88.0, // Shows as 88 in dial
      hrv: 65.0,
      restingHR: 52.0,
      sleepTotalMinutes: 492.0, // 8h 12m
      sleepEfficiency: 0.86, // 86%
      steps: 7450,
      activeCalories: 450.0,
      aiNote: "Target Effort: 8.5/10 (Build Phase) — CNS primed for high tension. Push for personal bests in today's bench press.",
    },
    create: {
      userId: user.id,
      date: todayIso,
      recoveryScore: 88.0,
      hrv: 65.0,
      restingHR: 52.0,
      sleepTotalMinutes: 492.0,
      sleepEfficiency: 0.86,
      steps: 7450,
      activeCalories: 450.0,
      aiNote: "Target Effort: 8.5/10 (Build Phase) — CNS primed for high tension. Push for personal bests in today's bench press.",
    },
  });
  console.log("HealthKit biometric snapshot saved.");

  // 7. Upsert Readiness Record for Today
  await prisma.readiness.upsert({
    where: {
      userId_day_month_year: {
        userId: user.id,
        day: dayStr,
        month: monthStr,
        year: yearStr,
      },
    },
    update: {
      sleep: "HOURS_8_PLUS",
      recovery: "OPTIMAL",
      aiTarget: "Target Effort: 8.5/10 (Build Phase) — CNS primed for high tension. Push for personal bests in today's bench press.",
    },
    create: {
      userId: user.id,
      day: dayStr,
      month: monthStr,
      year: yearStr,
      sleep: "HOURS_8_PLUS",
      recovery: "OPTIMAL",
      aiTarget: "Target Effort: 8.5/10 (Build Phase) — CNS primed for high tension. Push for personal bests in today's bench press.",
    },
  });
  console.log("Readiness record saved.");

  // 8. Upsert Nutrition Library Items
  const oats = await upsertSharedNutritionItem({
    name: "Steel Cut Oats with Whey Protein",
    category: NutritionCategory.CARB_SOURCE,
    servingSize: 100,
    servingUnit: "g",
    caloriesPerServing: 550,
    proteinPerServing: 42,
    carbsPerServing: 68,
    fatPerServing: 12,
    mealTypes: [MealType.BREAKFAST],
  });

  const chicken = await upsertSharedNutritionItem({
    name: "Grilled Lemon Herb Chicken with Quinoa & Avocado",
    category: NutritionCategory.PROTEIN_SOURCE,
    servingSize: 250,
    servingUnit: "g",
    caloriesPerServing: 680,
    proteinPerServing: 58,
    carbsPerServing: 62,
    fatPerServing: 22,
    mealTypes: [MealType.LUNCH],
  });

  const yogurt = await upsertSharedNutritionItem({
    name: "Greek Yogurt Parfait with Raw Honey",
    category: NutritionCategory.DAIRY,
    servingSize: 200,
    servingUnit: "g",
    caloriesPerServing: 320,
    proteinPerServing: 28,
    carbsPerServing: 30,
    fatPerServing: 10,
    mealTypes: [MealType.SNACK],
  });

  const salmon = await upsertSharedNutritionItem({
    name: "Seared Atlantic Salmon Fillet",
    category: NutritionCategory.PROTEIN_SOURCE,
    servingSize: 200,
    servingUnit: "g",
    caloriesPerServing: 290,
    proteinPerServing: 17,
    carbsPerServing: 30,
    fatPerServing: 11,
    mealTypes: [MealType.DINNER],
  });

  // Seed Today's Meals (Total: 1,840 kcal | 145g Protein | 190g Carbs | 55g Fat)
  await prisma.userMealLog.deleteMany({
    where: { userId: user.id, day: dayStr, month: monthStr, year: yearStr },
  });

  await prisma.userMealLog.createMany({
    data: [
      {
        userId: user.id,
        nutritionId: oats.id,
        mealType: MealType.BREAKFAST,
        calories: 550,
        protein: 42,
        carbs: 68,
        fat: 12,
        day: dayStr,
        month: monthStr,
        year: yearStr,
      },
      {
        userId: user.id,
        nutritionId: chicken.id,
        mealType: MealType.LUNCH,
        calories: 680,
        protein: 58,
        carbs: 62,
        fat: 22,
        day: dayStr,
        month: monthStr,
        year: yearStr,
      },
      {
        userId: user.id,
        nutritionId: yogurt.id,
        mealType: MealType.SNACK,
        calories: 320,
        protein: 28,
        carbs: 30,
        fat: 10,
        day: dayStr,
        month: monthStr,
        year: yearStr,
      },
      {
        userId: user.id,
        nutritionId: salmon.id,
        mealType: MealType.DINNER,
        calories: 290,
        protein: 17,
        carbs: 30,
        fat: 11,
        day: dayStr,
        month: monthStr,
        year: yearStr,
      },
    ],
  });
  console.log("Today's meals seeded (1,840 kcal, 145g protein, 190g carbs, 55g fat).");

  // Also seed past 6 days meals to guarantee a continuous 7-day streak!
  for (let i = 1; i <= 6; i++) {
    const pastDate = new Date(Date.now() - i * 86400000);
    const pDay = String(pastDate.getDate());
    const pMonth = String(pastDate.getMonth() + 1);
    const pYear = String(pastDate.getFullYear());

    await prisma.userMealLog.deleteMany({
      where: { userId: user.id, day: pDay, month: pMonth, year: pYear },
    });
    await prisma.userMealLog.create({
      data: {
        userId: user.id,
        nutritionId: chicken.id,
        mealType: MealType.LUNCH,
        calories: 700,
        protein: 50,
        carbs: 70,
        fat: 20,
        day: pDay,
        month: pMonth,
        year: pYear,
      },
    });
  }
  console.log("Past 6 days meal logs seeded for 7-day streak validation.");

  // 9. Seed Today's Water (Total: 1,750 ml)
  await prisma.userWaterLog.deleteMany({
    where: { userId: user.id, day: dayStr, month: monthStr, year: yearStr },
  });

  await prisma.userWaterLog.createMany({
    data: [
      { userId: user.id, amountMl: 500, day: dayStr, month: monthStr, year: yearStr },
      { userId: user.id, amountMl: 500, day: dayStr, month: monthStr, year: yearStr },
      { userId: user.id, amountMl: 500, day: dayStr, month: monthStr, year: yearStr },
      { userId: user.id, amountMl: 250, day: dayStr, month: monthStr, year: yearStr },
    ],
  });
  console.log("Today's water logged (1,750 ml).");

  // 10. Bust Redis Cache so fresh DB data loads immediately
  await redis.del(`home:${user.id}`);
  await redis.del(`user:${user.id}`);
  console.log(`Cache cleared for home:${user.id}`);

  console.log("\n==========================================");
  console.log("✨ DATABASE SEEDING COMPLETED SUCCESSFULLY ✨");
  console.log(`User ID:     ${user.id}`);
  console.log(`Email:       ${user.email}`);
  console.log(`Name:        V`);
  console.log(`Readiness:   88 (Optimal Recovery)`);
  console.log(`Workout:     Chest & Core Hypertrophy (5 Exercises, 55 min)`);
  console.log(`Nutrition:   1,840 / 2,400 kcal | 145g / 180g P | 190g / 220g C | 55g / 70g F`);
  console.log(`Hydration:   1,750 / 3,000 ml`);
  console.log(`Streak:      7 Days`);
  console.log("==========================================\n");
}

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
