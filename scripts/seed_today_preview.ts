import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DayOfWeek, MealType, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { getHomeData } from '../modules/home/home_service';

// Deliberately limited to the account requested for this preview.
const email = 'vklvl0101@gmail.com';
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const part = (type: string) => parts.find(p => p.type === type)!.value;
const date = `${part('year')}-${part('month')}-${part('day')}`;
const day = String(Number(part('day')));
const month = String(Number(part('month')));
const year = part('year');
const today = new Date(`${date}T12:00:00+05:30`);
const dayOfWeek = [DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY][today.getUTCDay()]!;
const seedId = (kind: string) => {
  const hex = createHash('sha256').update(`fitai-today-preview:${email}:${date}:${kind}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

async function main() {
  const user = await prisma.user.findUnique({
    where: { email }, select: { id: true, onboarding: { select: { name: true } } },
  });
  if (!user?.onboarding) throw new Error('Requested account must exist and have completed onboarding.');
  const userId = user.id;
  const dateWhere = { userId, day, month, year };
  const [snapshot, meals, water, plan, catalog] = await Promise.all([
    prisma.healthKitSnapshot.findUnique({ where: { userId_date: { userId, date } }, select: { id: true, sourceProvider: true } }),
    prisma.userMealLog.count({ where: dateWhere }),
    prisma.userWaterLog.count({ where: dateWhere }),
    prisma.userWorkout.findFirst({
      where: { userId, status: { notIn: ['SKIPPED', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, weekLabel: true, items: { select: { id: true, dayOfWeek: true, workoutId: true, status: true } } },
    }),
    prisma.workout.findMany({ take: 6, orderBy: { name: 'asc' }, select: { id: true } }),
  ]);
  console.log(JSON.stringify({ email, date, timezone: 'Asia/Kolkata', mode: process.argv.includes('--apply') ? 'apply' : 'inspect',
    existing: { healthSnapshot: Boolean(snapshot), snapshotSource: snapshot?.sourceProvider, mealLogs: meals,
      waterLogs: water, activePlan: Boolean(plan), planWeek: plan?.weekLabel,
      todaysExercises: plan?.items.filter(i => i.dayOfWeek === dayOfWeek).length ?? 0,
      planDays: [...new Set(plan?.items.map(i => i.dayOfWeek))], catalogExercises: catalog.length },
    proposed: { healthSnapshot: !snapshot, mealLogs: meals === 0 ? 3 : 0, waterLogs: water === 0 ? 3 : 0,
      sampleSession: !plan?.items.some(i => i.dayOfWeek === dayOfWeek),
      catalogEntriesIfEmpty: catalog.length === 0 ? 6 : 0 },
  }, null, 2));
  if (!process.argv.includes('--apply')) return;

  const created = await prisma.$transaction(async tx => {
    const records: { table: string; id: string }[] = [];
    const snapshotId = seedId('health');
    // Empty update preserves all existing measurements on reruns and real data.
    const savedSnapshot = await tx.healthKitSnapshot.upsert({
      where: { userId_date: { userId, date } }, update: {},
      create: { id: snapshotId, userId, date, sourceProvider: 'FITAI_PREVIEW',
        hrv: 68, restingHR: 54, sleepTotalMinutes: 462, sleepDeepMinutes: 92,
        sleepRemMinutes: 108, sleepCoreMinutes: 262, sleepEfficiency: 91,
        steps: 6840, activeCalories: 420, recoveryScore: 84,
        aiNote: 'Sample day: follow your planned session and keep your usual rest between sets.' },
    });
    if (!snapshot && savedSnapshot.id === snapshotId) records.push({ table: 'HealthKitSnapshot', id: snapshotId });

    // Never add sample totals on top of already logged food or water.
    if (await tx.userMealLog.count({ where: dateWhere }) === 0) {
      const samples: [string, MealType, number, number, number, number][] = [
        ['Breakfast bowl', MealType.BREAKFAST, 540, 34, 75, 12],
        ['Lunch plate', MealType.LUNCH, 730, 45, 90, 17],
        ['Yogurt & fruit', MealType.SNACK, 210, 21, 24, 8],
      ];
      for (const [name, mealType, calories, protein, carbs, fat] of samples) {
        const nutritionId = seedId(`food:${mealType}`);
        const food = await tx.nutrition.upsert({ where: { id: nutritionId }, update: {},
          create: { id: nutritionId, userId, name: `Today preview · ${date} · ${name}`,
            category: 'PROTEIN_SOURCE', servingSize: 1, servingUnit: 'portion',
            caloriesPerServing: calories, proteinPerServing: protein, carbsPerServing: carbs,
            fatPerServing: fat, mealTypes: [mealType] } });
        records.push({ table: 'Nutrition', id: food.id });
        const log = await tx.userMealLog.create({ data: {
          id: seedId(`meal:${mealType}`), ...dateWhere, nutritionId, mealType, calories, protein, carbs, fat,
        } });
        records.push({ table: 'UserMealLog', id: log.id });
      }
    }
    if (await tx.userWaterLog.count({ where: dateWhere }) === 0) {
      for (const [index, amountMl] of [500, 500, 450].entries()) {
        const log = await tx.userWaterLog.create({ data: { id: seedId(`water:${index}`), ...dateWhere, amountMl,
          sourceProvider: 'FITAI_PREVIEW' } });
        records.push({ table: 'UserWaterLog', id: log.id });
      }
    }
    let activePlan = await tx.userWorkout.findFirst({
      where: { userId, status: { notIn: ['SKIPPED', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' },
    });
    const todaysItems = activePlan ? await tx.userWorkoutItem.count({ where: { userWorkoutId: activePlan.id, dayOfWeek } }) : 0;
    if (todaysItems === 0) {
      const exerciseIds = catalog.map(w => w.id);
      if (exerciseIds.length === 0) {
        // The database catalog is empty. Add only the six reference exercises
        // needed for this account's sample session, without running a global seed.
        const raw: { id: string; name: string; description: string; bodyPart: string; equipment: string;
          instructions: string[]; target?: string; videoUrl?: string; thumbnailUrl?: string }[] =
          JSON.parse(await readFile('50gymworkouts.json', 'utf8'));
        for (const [index, entry] of raw.filter(w => w.bodyPart !== 'cardio').slice(0, 6).entries()) {
          const existing = await tx.workout.findUnique({ where: { name: entry.name } });
          const exercise = existing ?? await tx.workout.create({ data: {
            id: seedId(`catalog:${index}`), name: entry.name, description: entry.description,
            category: 'strength', bodyPart: entry.bodyPart, equipment: entry.equipment,
            target: entry.target, instructions: entry.instructions, trainingLocation: 'GYM',
            exerciseCode: `today-preview:${date}:${entry.id}`, duration: 8,
            videoUrl: entry.videoUrl ?? `exercises/${entry.id.padStart(4, '0')}.mp4`,
            thumbnailUrl: entry.thumbnailUrl,
          } });
          if (!existing) records.push({ table: 'Workout', id: exercise.id });
          exerciseIds.push(exercise.id);
        }
      }
      if (!activePlan) {
        activePlan = await tx.userWorkout.create({ data: {
          id: seedId('plan'), userId, weekLabel: `Preview · ${date}`, status: 'NOT_STARTED',
          aiNote: 'Sample session for your Today preview. Adjust loads to your usual training level.',
        } });
        records.push({ table: 'UserWorkout', id: activePlan.id });
      }
      for (const [index, workoutId] of exerciseIds.entries()) {
        const item = await tx.userWorkoutItem.create({ data: {
          id: seedId(`exercise:${index}`), userWorkoutId: activePlan.id, workoutId,
          sourceProvider: 'FITAI_PREVIEW',
          dayOfWeek, orderIndex: index, targetSets: 3, targetReps: '8–12', targetWeight: 0, targetRpe: 7,
        } });
        records.push({ table: 'UserWorkoutItem', id: item.id });
      }
    }
    return records;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });

  await mkdir('seed-results', { recursive: true });
  // Timestamped receipt: reruns do not overwrite the first insertion receipt.
  const receiptPath = `seed-results/today-preview-${date}-${Date.now()}.json`;
  await writeFile(receiptPath, JSON.stringify({ email, date, created }, null, 2));
  await redis.del(`home:${userId}`, `healthkit:${userId}:${date}`, `history:recovery:${userId}:7`,
    `userworkout:${userId}:${dayOfWeek}`, ...(plan ? [`userworkout:${userId}:${plan.weekLabel}:${dayOfWeek}`] : []))
    .catch(() => console.warn('Database seed is committed; Redis is unavailable. Existing home cache expires after 30 seconds.'));
  const home = await getHomeData(userId, true);
  await mkdir('../mobile/build', { recursive: true });
  await writeFile('../mobile/build/today-preview-data.json', JSON.stringify(home, null, 2));
  console.log(JSON.stringify({ createdCount: created.length, receiptPath, verifiedFromDatabase: {
    readiness: home.readiness?.score, readinessSource: home.readiness?.source,
    caloriesConsumed: home.nutrition.calories.consumed, waterMl: home.nutrition.water.consumed,
    exercises: home.todayWorkout?.exerciseCount ?? 0,
  } }, null, 2));
}

main().catch((error: unknown) => {
  // Do not print Prisma connection strings or SQL parameters on failure.
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]') : 'Seed failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
