import prisma from "../config/prisma";
import redis from "../config/redis";

async function resetUserPlans() {
  const email = "vklvl0101@gmail.com";
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user) {
    console.error("User not found:", email);
    return;
  }

  const userId = user.id;
  console.log(`Resetting plans and workout history for ${email} (${userId})...`);

  await prisma.$transaction(async (tx) => {
    // 1. Delete weekly personal plans
    const deletedPlans = await tx.weeklyPersonalPlan.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedPlans.count} weeklyPersonalPlans`);

    // 2. Delete weekly plan runs
    const deletedRuns = await tx.weeklyPlanRun.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedRuns.count} weeklyPlanRuns`);

    // 3. Delete workout set logs
    const deletedSetLogs = await tx.workoutSetLog.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedSetLogs.count} workoutSetLogs`);

    // 4. Delete workout sessions
    const deletedSessions = await tx.workoutSession.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedSessions.count} workoutSessions`);

    // 5. Delete user workouts
    const deletedWorkouts = await tx.userWorkout.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedWorkouts.count} userWorkouts`);

    // 6. Delete meal plans
    const deletedMealPlans = await tx.userMealPlan.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedMealPlans.count} mealPlans`);

    // 7. Delete meal logs
    const deletedMealLogs = await tx.userMealLog.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedMealLogs.count} mealLogs`);

    // 8. Delete planner demo weeks if any
    const deletedDemoWeeks = await tx.plannerDemoWeek.deleteMany({
      where: { userId },
    });
    console.log(`Deleted ${deletedDemoWeeks.count} plannerDemoWeeks`);
  });

  // Clear Redis caches
  try {
    await redis.del(`user:${userId}`);
    await redis.del(`home:${userId}`);
    await redis.del(`workout:${userId}`);
    console.log("Cleared Redis caches for user");
  } catch (err) {
    console.warn("Redis cache clearance skipped:", (err as Error).message);
  }

  console.log("Successfully reset all plans and workouts! User can now generate a new plan immediately.");
}

resetUserPlans()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
