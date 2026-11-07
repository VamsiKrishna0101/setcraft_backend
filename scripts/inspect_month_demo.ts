import prisma from '../config/prisma';
import { dateInZone, addDays } from '../graphworkflow/common/types';

async function main() {
  if (process.argv.includes('--foods')) {
    const patterns = ['oat', 'yogurt', 'chicken', 'rice', 'salmon', 'potato', 'broccoli', 'apple', 'almond', 'olive', 'bread', 'egg'];
    for (const text of patterns) {
      const foods = await prisma.nutrition.findMany({ where: { userId: null, isVerified: true,
        name: { contains: text, mode: 'insensitive' } }, select: { id: true, name: true, servingSize: true,
        servingUnit: true, caloriesPerServing: true }, take: 8, orderBy: { name: 'asc' } });
      console.log(JSON.stringify({ pattern: text, foods }));
    }
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: 'vklvl0101@gmail.com' }, select: {
    id: true, wearableUsage: true, onboarding: { select: { weight: true, height: true, gender: true } },
  } });
  if (!user) throw new Error('Requested account not found');
  const today = dateInZone('Asia/Kolkata');
  const start = addDays(today, -29);
  const userId = user.id;
  const [sessions, workouts, meals, water, wellness, body, plans, routines] = await Promise.all([
    prisma.workoutSession.findMany({ where: { userId, date: { gte: start } }, select: { id: true, date: true, name: true, status: true } }),
    prisma.userWorkout.findMany({ where: { userId, scheduledDate: { gte: start } }, select: { id: true, scheduledDate: true, aiNote: true, _count: { select: { items: true } } } }),
    prisma.userMealLog.count({ where: { userId } }), prisma.userWaterLog.count({ where: { userId } }),
    prisma.dailyWellnessEntry.count({ where: { userId, date: { gte: start } } }),
    prisma.bodyAssessment.findMany({ where: { userId }, select: { id: true, recordedDate: true, method: true, quality: true, analysisVersion: true } }),
    prisma.weeklyPersonalPlan.findMany({ where: { userId }, select: { id: true, weekStart: true, status: true, synthetic: true } }),
    prisma.workoutRoutine.count({ where: { userId } }),
  ]);
  console.log(JSON.stringify({ today, start, user, sessions, workouts, meals, water, wellness, body, plans, routines }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
