import prisma from "../config/prisma";
import { getPlanAvailability } from "../graphworkflow/service";
import { realSnapshotWhere, realMealWhere } from "../utils/real_data";
import { invalidateUserNutritionCache } from "../modules/nutrition/nutrition_service";
import { dateInZone } from "../graphworkflow/common/types";

// Scope cleanup to the member who explicitly requested removal of demo data.
const email = "vklvl0101@gmail.com";
const apply = process.argv.includes("--apply");

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  const result = await prisma.$transaction(
    async (database) => {
      await database.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id} FOR UPDATE`;

      const plans = await database.weeklyPersonalPlan.findMany({
        where: { userId: user.id, synthetic: true },
        select: { id: true, runId: true, status: true },
      });
      const runs = await database.weeklyPlanRun.findMany({
        where: {
          userId: user.id,
          input: { path: ["synthetic"], equals: true },
        },
        select: { id: true },
      });
      const runIds = [
        ...new Set([
          ...plans.map((plan) => plan.runId),
          ...runs.map((run) => run.id),
        ]),
      ];
      const realPlanCount = await database.weeklyPersonalPlan.count({
        where: { userId: user.id, synthetic: false },
      });
      const demoWeekCount = await database.plannerDemoWeek.count({
        where: { userId: user.id },
      });
      const previewHealth = { userId: user.id, NOT: realSnapshotWhere };
      const previewMeals = { userId: user.id, NOT: realMealWhere };
      const previewHealthCount = await database.healthKitSnapshot.count({
        where: previewHealth,
      });
      const previewMealCount = await database.userMealLog.count({
        where: previewMeals,
      });
      const previewWater = {
        userId: user.id,
        OR: [
          {
            sourceProvider: {
              contains: "preview",
              mode: "insensitive" as const,
            },
          },
          {
            sourceProvider: { contains: "demo", mode: "insensitive" as const },
          },
          {
            sourceProvider: {
              contains: "sample",
              mode: "insensitive" as const,
            },
          },
        ],
      };
      const previewWellness = {
        userId: user.id,
        OR: [
          { source: { contains: "preview", mode: "insensitive" as const } },
          { source: { contains: "demo", mode: "insensitive" as const } },
          { source: { contains: "sample", mode: "insensitive" as const } },
        ],
      };
      const previewWaterCount = await database.userWaterLog.count({
        where: previewWater,
      });
      const previewWellnessCount = await database.dailyWellnessEntry.count({
        where: previewWellness,
      });

      if (plans.some((plan) => plan.status === "ACTIVE")) {
        throw new Error(
          "An active synthetic plan needs separate schedule review before cleanup.",
        );
      }

      if (apply) {
        await database.weeklyPersonalPlan.deleteMany({
          where: {
            userId: user.id,
            id: { in: plans.map((plan) => plan.id) },
            synthetic: true,
          },
        });
        await database.weeklyPlanRun.deleteMany({
          where: { userId: user.id, id: { in: runIds }, plan: null },
        });
        await database.plannerDemoWeek.deleteMany({
          where: { userId: user.id },
        });
        await database.healthKitSnapshot.deleteMany({ where: previewHealth });
        await database.userMealLog.deleteMany({ where: previewMeals });
        await database.userWaterLog.deleteMany({ where: previewWater });
        await database.dailyWellnessEntry.deleteMany({
          where: previewWellness,
        });
      }

      return {
        applied: apply,
        syntheticPlans: plans.length,
        syntheticRuns: runIds.length,
        demoWeeks: demoWeekCount,
        previewHealth: previewHealthCount,
        previewMeals: previewMealCount,
        previewWater: previewWaterCount,
        previewWellness: previewWellnessCount,
        realPlansPreserved: realPlanCount,
      };
    },
    { timeout: 20000 },
  );

  if (apply) {
    const [year, month, day] = dateInZone("Asia/Kolkata").split("-");
    await invalidateUserNutritionCache(user.id, day!, month!, year!);
  }

  console.log(
    JSON.stringify({
      ...result,
      availability: await getPlanAvailability(user.id),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
