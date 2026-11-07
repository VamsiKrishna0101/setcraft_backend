import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DayOfWeek, MealType, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { addDays, dateInZone, planSchema } from '../graphworkflow/common/types';
import { weekDates, weekday, routineSchema } from '../modules/workout/session/session_types';
import { metricsSchema } from '../modules/body/body_types';
import { buildDailyReadiness, getHomeData } from '../modules/home/home_service';
import { getTrainingWeek } from '../modules/workout/session/session_service';
import { getBodyProgress } from '../modules/progress/body/body_service';
import { getWellnessProgress } from '../modules/progress/wellness/wellness_service';
import { trainingData } from '../modules/progress/training/training_data';

// This fixture is deliberately restricted to the account requested by the user.
// USER is the app-entry channel required by the existing history queries.
// Deterministic IDs, client keys, notes and the receipt identify synthetic records.
// No wearable snapshots, photos, billing, notification jobs or AI calls are created.
const email = 'vklvl0101@gmail.com';
const seed = 'account-month-demo-v1';
const timezone = 'Asia/Kolkata';
const today = dateInZone(timezone);
const start = addDays(today, -29);
const last = weekDates(today).at(-1)!;
const receiptPath = 'seed-results/account-month-demo.json';

function id(key: string) {
  const hash = createHash('sha256').update(seed + ':' + email + ':' + key).digest('hex');
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-4' + hash.slice(13, 16)
    + '-a' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
}

function dateParts(date: string) {
  const [year, month, day] = date.split('-');
  return { year: year!, month: String(Number(month)), day: String(Number(day)) };
}

function at(date: string, hour = 8) {
  return new Date(date + 'T' + String(hour).padStart(2, '0') + ':00:00+05:30');
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, include: { onboarding: true } });
  if (!user?.onboarding) throw new Error('This account must exist with completed onboarding.');
  if (user.wearableUsage !== 'NONE') throw new Error('This phone-only fixture requires the existing no-wearable preference.');
  const profile = user.onboarding;
  if (profile.weight == null) throw new Error("Demo history needs a saved body weight.");
  const profileWeight = profile.weight;
  const userId = user.id;
  const days: string[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) days.push(date);
  const weeks = [...new Set(days.map(date => weekDates(date)[0]!))];

  const [catalog, foodCatalog] = await Promise.all([
    prisma.workout.findMany({ select: { id: true, name: true, equipment: true, target: true, bodyPart: true } }),
    prisma.nutrition.findMany({ where: { userId: null, isVerified: true, servingUnit: 'g' } }),
  ]);

  function exercise(pattern: RegExp, base: number, increment: number, region: string, movement: string, reps = 10) {
    const found = catalog.filter(row => pattern.test(row.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!found) throw new Error('Missing exercise for ' + pattern.source);
    return { ...found, base, increment, region, movement, reps };
  }

  const exercises = [
    exercise(/^barbell bench press$/i, 35, 2.5, 'chest', 'push'),
    exercise(/^barbell (back|full) squat$/i, 40, 2.5, 'legs', 'squat', 8),
    exercise(/^(barbell bent.over row|barbell bent.over rows)$/i, 25, 2.5, 'back', 'pull'),
    exercise(/^dumbbell (seated |standing )?shoulder press$/i, 8, 1, 'shoulders', 'shoulders'),
    exercise(/^dumbbell (biceps )?curl$/i, 6, 1, 'biceps', 'biceps', 12),
    exercise(/^dumbbell (standing |seated )?(triceps |tricep )?extension$/i, 6, 1, 'triceps', 'triceps', 12),
    exercise(/^barbell romanian deadlift$/i, 30, 2.5, 'legs', 'hinge', 8),
    exercise(/^dumbbell (bent.over |one arm |single arm )?row$/i, 10, 1, 'back', 'pull'),
    exercise(/^dumbbell (incline )?fly$/i, 5, 0.5, 'chest', 'push', 12),
    exercise(/^dumbbell lateral raise$/i, 4, 0.5, 'shoulders', 'shoulders', 12),
    exercise(/^bodyweight standing calf raise$/i, 0, 0, 'legs', 'calves', 15),
    exercise(/^lying leg raise flat bench$/i, 0, 0, 'core', 'core', 12),
  ];
  const templates = [[0, 1, 2, 3, 4, 11], [6, 7, 8, 9, 5, 10], [1, 0, 7, 9, 4, 11]];

  function food(pattern: RegExp) {
    const found = foodCatalog.filter(row => pattern.test(row.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!found) throw new Error('Missing catalog food for ' + pattern.source);
    return found;
  }
  const oats = food(/^rolled oats.*dry$/i);
  const yogurt = food(/^low-fat greek yogurt$/i);
  const chicken = food(/^chicken breast.*roasted.*skinless$/i);
  const rice = food(/^brown rice.*cooked$/i);
  const salmon = food(/^farmed salmon.*baked$/i);
  const potatoes = food(/^potato.*boiled$/i);
  const broccoli = food(/^broccoli.*boiled$/i);
  const fruit = food(/^apple$/i);
  const nuts = food(/^almonds$/i);
  const oliveOil = food(/^olive oil$/i);
  const bread = food(/^wholemeal bread$/i);
  const eggs = food(/^boiled egg$/i);

  function nutrients(entry: typeof oats, grams: number) {
    const servings = grams / entry.servingSize;
    return { calories: rounded(entry.caloriesPerServing * servings), protein: rounded(entry.proteinPerServing * servings),
      carbs: rounded(entry.carbsPerServing * servings), fat: rounded(entry.fatPerServing * servings) };
  }

  function mealsFor(date: string) {
    const index = Math.max(0, days.indexOf(date));
    const portions: Array<{ mealType: MealType; hour: number; foods: Array<[typeof oats, number]> }> = [
      { mealType: 'BREAKFAST', hour: 8, foods: index % 3 === 0 ? [[bread, 120], [eggs, 120], [fruit, 150]] : [[oats, 90], [yogurt, 250], [fruit, 150]] },
      { mealType: 'LUNCH', hour: 13, foods: [[chicken, 180], [rice, 280], [broccoli, 160], [oliveOil, 15]] },
      { mealType: 'DINNER', hour: 19, foods: [[salmon, 170], [potatoes, 320], [broccoli, 180], [oliveOil, 15]] },
      { mealType: 'SNACK', hour: 16, foods: [[yogurt, 200], [nuts, 35], [fruit, 180]] },
    ];
    return portions.map(meal => {
      const portionFactor = [1, 0.94, 1.06, 0.98, 1.1, 0.92, 1.03][index % 7]!;
      const foods = meal.foods.map(([entry, amount]) => {
        const grams = Math.round(amount * portionFactor);
        return { foodId: entry.id, name: entry.name, grams, nutrients: nutrients(entry, grams), entry };
      });
      const totals = foods.reduce((sum, item) => ({ calories: rounded(sum.calories + item.nutrients.calories),
        protein: rounded(sum.protein + item.nutrients.protein), carbs: rounded(sum.carbs + item.nutrients.carbs),
        fat: rounded(sum.fat + item.nutrients.fat) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      return { ...meal, foods, totals };
    });
  }

  function workoutFor(date: string) {
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    const restDay = day === 0 || day === 6;
    const week = Math.max(0, weeks.indexOf(weekDates(date)[0]!));
    const deload = false;
    const name = restDay ? 'Sample rest day' : 'Sample full body ' + ['A', 'B', 'C'][(day - 1) % 3];
    const selected = restDay ? [] : templates[(day - 1) % 3]!;
    const plans = selected.map(index => {
      const entry = exercises[index]!;
      const bodyweight = entry.base === 0;
      const load = bodyweight ? 0 : entry.base + Math.floor(week / 2) * entry.increment;
      const weightKg = deload ? rounded(load * 0.85) : load;
      const count = deload ? 2 : 3;
      return { exerciseId: entry.id, name: entry.name, pattern: entry.movement, sets: count,
        repsMin: entry.reps, repsMax: entry.reps, weightKg, weightBasis: bodyweight ? 'bodyweight' as const : 'as_logged' as const,
        weightUnit: bodyweight ? 'bodyweight' as const : /dumbbell/i.test(entry.equipment) ? 'per_hand' as const : 'total_load' as const,
        targetRpe: deload ? 6 : 7, restSeconds: ['push', 'pull', 'squat', 'hinge'].includes(entry.movement) ? 120 : 90,
        setPrescriptions: Array.from({ length: count }, (_, set) => ({ setNumber: set + 1,
          repsMin: entry.reps, repsMax: entry.reps, weightKg, targetRpe: deload ? 6 : 7 })),
        reason: 'Sample exercise prescription for previewing the app; not individual coaching.',
        progression: deload ? 'Sample lighter week.' : 'Sample gradual load progression.', evidenceIds: [], alternativeIds: [] };
    });
    return { date, name, restDay, estimatedMinutes: restDay ? 0 : deload ? 40 : 55, exercises: plans };
  }

  const weeklyPlans = weeks.map(weekStart => {
    const nutritionDays = weekDates(weekStart).map(date => {
      const meals = mealsFor(date).map(meal => ({ mealType: meal.mealType,
        foods: meal.foods.map(({ entry, ...item }) => item), totals: meal.totals }));
      const totals = meals.reduce((sum, meal) => ({ calories: rounded(sum.calories + meal.totals.calories),
        protein: rounded(sum.protein + meal.totals.protein), carbs: rounded(sum.carbs + meal.totals.carbs),
        fat: rounded(sum.fat + meal.totals.fat) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      return { date, meals, totals };
    });
    return planSchema.parse({ weekStart, timezone, synthetic: true,
      historyCoverage: { loggedDays: 0, weeksWithLogs: 0, syntheticDays: days.filter(date => date < weekStart).length },
      summary: 'Demo weekly plan for exploring a populated app. Sample five-day full-body schedule.',
      warnings: ['Synthetic preview data. These loads, meals and measurements are not personal training advice.'],
      workouts: weekDates(weekStart).map(workoutFor), nutrition: { status: 'RECOMMENDED',
        reason: 'Sample catalog meals for demonstrating portions and nutrition history.',
        targets: nutritionDays[0]!.totals, days: nutritionDays },
      promptVersion: 'sample-fixture-v1', ruleVersion: seed, model: 'deterministic-fixture' });
  });

  console.log(JSON.stringify({ email, mode: process.argv.includes('--apply') ? 'apply' : 'inspect', start, end: today,
    days: days.length, weeks: weeks.length, exerciseNames: exercises.map(row => row.name),
    foodNames: [oats, yogurt, chicken, rice, salmon, potatoes, broccoli, fruit, nuts, oliveOil, bread, eggs].map(row => row.name) }));
  if (!process.argv.includes('--apply')) return;

  await mkdir('seed-results', { recursive: true });
  const previousReceipt = await readFile(receiptPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { records: [] };
    throw error;
  });
  const created: Array<{ table: string; id: string }> = [];
  function remember(table: string, rowId: string) { created.push({ table, id: rowId }); }
  const protectedModels = ['userWorkout', 'userWorkoutItem', 'workoutSession', 'workoutSetLog',
    'workoutDay', 'workoutRoutine', 'userMealLog', 'userWaterLog', 'dailyWellnessEntry',
    'muscleCheckIn', 'bodyAssessment', 'weeklyPlanRun', 'weeklyPersonalPlan', 'userMealPlan', 'userMealPlanItem'] as const;
  function ownerWhere(model: string) {
    if (model === 'userWorkoutItem') return { userWorkout: { userId } };
    if (model === 'userMealPlanItem') return { mealPlan: { userId } };
    return { userId };
  }
  const before = await Promise.all(protectedModels.map(async model => {
    const rows = await (prisma[model] as any).findMany({ where: ownerWhere(model), orderBy: { id: 'asc' } });
    return { model, ids: rows.map((row: { id: string }) => row.id),
      hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }));

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    for (const [dayIndex, date] of days.entries()) {
      const dateWhere = { userId, ...dateParts(date) };
      if (!await tx.dailyWellnessEntry.findUnique({ where: { userId_date: { userId, date } } })) {
        const sleepMinutes = [435, 465, 420, 480, 450, 405, 495][dayIndex % 7]! + (dayIndex % 3) * 5;
        const rowId = id('wellness:' + date);
        await tx.dailyWellnessEntry.create({ data: { id: rowId, userId, date, sleepMinutes,
          energy: dayIndex % 11 === 0 ? 2 : dayIndex % 3 === 0 ? 3 : 4,
          rested: sleepMinutes < 430 ? 3 : 4, soreness: dayIndex % 5 === 0 ? 3 : 2,
          source: 'sample_self_report', updatedAt: at(date) } });
        remember('DailyWellnessEntry', rowId);
      }
      if (!await tx.userMealLog.count({ where: dateWhere })) {
        const rows: Prisma.UserMealLogCreateManyInput[] = [];
        for (const meal of mealsFor(date)) for (const [foodIndex, entry] of meal.foods.entries()) {
          const servings = entry.grams / entry.entry.servingSize;
          rows.push({ id: id('meal:' + date + ':' + meal.mealType + ':' + foodIndex), ...dateWhere,
            nutritionId: entry.foodId, mealType: meal.mealType, servings, ...entry.nutrients,
            fiber: rounded(entry.entry.fiberPerServing * servings), sugar: rounded(entry.entry.sugarPerServing * servings),
            sodiumMg: rounded(entry.entry.sodiumPerServing * servings), createdAt: at(date, meal.hour), updatedAt: at(date, meal.hour) });
        }
        await tx.userMealLog.createMany({ data: rows });
        rows.forEach(row => remember('UserMealLog', row.id!));
      }
      if (!await tx.userWaterLog.count({ where: dateWhere })) {
        const rows = [600, 700, 650, 500 + dayIndex % 4 * 100].map((amountMl, index) => ({
          id: id('water:' + date + ':' + index), ...dateWhere, amountMl, sourceProvider: 'USER', createdAt: at(date, 8 + index * 3) }));
        await tx.userWaterLog.createMany({ data: rows });
        rows.forEach(row => remember('UserWaterLog', row.id));
      }
      if (dayIndex % 3 === 0 || date === today) {
        const muscleIds = ['chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'upper_back', 'lats', 'lower_back', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
        const existingCheckIns = await tx.muscleCheckIn.findMany({ where: { userId, date }, select: { muscleId: true } });
        const rows = muscleIds.filter(muscleId => !existingCheckIns.some(row => row.muscleId === muscleId))
          .map((muscleId, index) => ({ id: id('muscle:' + date + ':' + muscleId), userId, date, muscleId,
            soreness: 1 + (dayIndex + index) % 3, updatedAt: at(date) }));
        if (rows.length) await tx.muscleCheckIn.createMany({ data: rows });
        rows.forEach(row => remember('MuscleCheckIn', row.id));
      }
      if (dayIndex % 3 === 0 || date === today) {
        const rowId = id('body:' + date);
        if (!await tx.bodyAssessment.findFirst({ where: { userId, recordedDate: date } })) {
          const week = Math.floor(dayIndex / 7);
          const metric = (value: number, source = 'tape') => ({ value: rounded(value), source });
          const metrics = metricsSchema.parse({ weightKg: metric(profileWeight - 1.6 + dayIndex / days.length * 1.6, 'scale'),
            bodyFatPct: metric(19.5 - week * 0.12, 'manual_estimate'), chestCm: metric(98 + week * 0.15),
            waistCm: metric(86 - week * 0.15), hipsCm: metric(97 + week * 0.05),
            leftArmCm: metric(32.8 + week * 0.08), rightArmCm: metric(33.1 + week * 0.08),
            leftThighCm: metric(55.8 + week * 0.07), rightThighCm: metric(56.1 + week * 0.07),
            leftCalfCm: metric(36.1 + week * 0.04), rightCalfCm: metric(36.3 + week * 0.04), neckCm: metric(37.5) });
          await tx.bodyAssessment.create({ data: { id: rowId, userId, recordedDate: date, metrics,
            // Owner-requested manual demo entries are visible in the ordinary app.
            // Keep provenance nested so the legacy quarantine for old preview fixtures
            // does not hide this explicitly requested account history. No scan is faked.
            observations: [], quality: { demoData: { synthetic: true, seed, requestedByAccountOwner: true },
              photoRetention: 'not_saved', focusStatus: 'not_requested' },
            summary: 'Sample measurements for app preview. No photo scan or AI analysis was performed.', method: 'entered',
            analysisVersion: seed, heightCm: profile.height, gender: profile.gender, createdAt: at(date), updatedAt: at(date) } });
          remember('BodyAssessment', rowId);
        }
      }
    }

    for (let date = start; date <= last; date = addDays(date, 1)) {
      const workout = workoutFor(date);
      const existing = await tx.workoutSession.findUnique({ where: { userId_date: { userId, date } } });
      const planned = await tx.userWorkout.findUnique({ where: { userId_scheduledDate: { userId, scheduledDate: date } } });
      const setting = await tx.workoutDay.findUnique({ where: { userId_date: { userId, date } } });
      if (existing || planned || setting) continue;
      const dayId = id('day:' + date);
      await tx.workoutDay.create({ data: { id: dayId, userId, date, name: workout.name, restDay: workout.restDay } });
      remember('WorkoutDay', dayId);
      if (workout.restDay) continue;
      const completed = date < today;
      const workoutId = id('workout:' + date);
      const time = at(date, 17);
      await tx.userWorkout.create({ data: { id: workoutId, userId, scheduledDate: date,
        weekLabel: weekDates(date)[0]!, status: completed ? 'COMPLETED' : 'NOT_STARTED',
        aiNote: 'Sample workout for app preview; not an AI-generated recommendation.', createdAt: at(date, 7), updatedAt: time,
        items: { create: workout.exercises.map((entry, index) => ({ id: id('item:' + date + ':' + index),
          workoutId: entry.exerciseId, dayOfWeek: weekday(date) as DayOfWeek, orderIndex: index,
          targetSets: entry.sets, targetReps: String(entry.repsMin), targetWeight: entry.weightKg,
          setTargets: { weightBasis: entry.weightBasis, weightUnit: entry.weightUnit, sets: entry.setPrescriptions },
          targetRpe: entry.targetRpe, restSeconds: entry.restSeconds, sourceProvider: 'USER',
          status: completed ? 'COMPLETED' : 'NOT_STARTED', completedAt: completed ? time : null,
          createdAt: at(date, 7), updatedAt: time })) } } });
      remember('UserWorkout', workoutId);
      workout.exercises.forEach((entry, index) => remember('UserWorkoutItem', id('item:' + date + ':' + index)));
      if (!completed) continue;
      const sessionId = id('session:' + date);
      await tx.workoutSession.create({ data: { id: sessionId, userId, date, name: workout.name,
        userWorkoutId: workoutId, status: 'COMPLETED', startedAt: at(date, 16), finishedAt: time,
        durationSeconds: 3600, updatedAt: time } });
      remember('WorkoutSession', sessionId);
      const logs = workout.exercises.flatMap((entry, exerciseIndex) => entry.setPrescriptions.map((set, setIndex) => ({
        id: id('set:' + date + ':' + exerciseIndex + ':' + setIndex), userId,
        clientKey: seed + ':' + date + ':' + exerciseIndex + ':' + setIndex,
        userWorkoutItemId: id('item:' + date + ':' + exerciseIndex), setNumber: set.setNumber,
        reps: Math.max(5, set.repsMin - (setIndex === 2 && weeks.indexOf(weekDates(date)[0]!) % 2 === 0 ? 1 : 0)),
        weight: set.weightKg, rpe: rounded(set.targetRpe + setIndex * 0.3), ...dateParts(date),
        createdAt: new Date(at(date, 16).getTime() + (exerciseIndex * 8 + setIndex * 2) * 60000) })));
      await tx.workoutSetLog.createMany({ data: logs });
      logs.forEach(row => remember('WorkoutSetLog', row.id));
    }

    for (const plan of weeklyPlans) {
      const existing = await tx.weeklyPersonalPlan.findFirst({ where: { userId, weekStart: plan.weekStart } });
      if (!existing) {
        const runId = id('run:' + plan.weekStart);
        const planId = id('weekly:' + plan.weekStart);
        await tx.weeklyPlanRun.create({ data: { id: runId, userId, weekStart: plan.weekStart,
          contextHash: seed, status: 'COMPLETED', stage: 'complete', progress: { percent: 100 },
          input: { synthetic: true, seed, note: 'Fixture only. No graph execution or AI calls.' },
          createdAt: at(plan.weekStart), updatedAt: at(plan.weekStart) } });
        await tx.weeklyPersonalPlan.create({ data: { id: planId, userId, runId, weekStart: plan.weekStart,
          version: 1, status: plan.weekStart === weeks.at(-1) ? 'ACTIVE' : 'ARCHIVED', synthetic: true,
          payload: plan as unknown as Prisma.InputJsonValue, promptVersion: plan.promptVersion,
          ruleVersion: seed, model: plan.model, activatedAt: at(plan.weekStart), createdAt: at(plan.weekStart) } });
        remember('WeeklyPlanRun', runId);
        remember('WeeklyPersonalPlan', planId);
      }
      if (!await tx.userMealPlan.findUnique({ where: { userId_weekLabel: { userId, weekLabel: plan.weekStart } } })) {
        const mealPlanId = id('meal-plan:' + plan.weekStart);
        await tx.userMealPlan.create({ data: { id: mealPlanId, userId, weekLabel: plan.weekStart,
          aiNote: 'Sample meal plan for app preview.', status: plan.weekStart === weeks.at(-1) ? 'NOT_STARTED' : 'COMPLETED',
          createdAt: at(plan.weekStart), items: { create: plan.nutrition.days.flatMap(day =>
            day.meals.flatMap(meal => meal.foods.map((entry, foodIndex) => {
              const loggedId = id('meal:' + day.date + ':' + meal.mealType + ':' + foodIndex);
              const isLogged = created.some(row => row.table === 'UserMealLog' && row.id === loggedId)
                || previousReceipt.records.some((row: { table: string; id: string }) => row.table === 'UserMealLog' && row.id === loggedId);
              const catalogFood = foodCatalog.find(row => row.id === entry.foodId)!;
              return { id: id('meal-plan-item:' + day.date + ':' + meal.mealType + ':' + foodIndex),
                nutritionId: entry.foodId, dayOfWeek: weekday(day.date) as DayOfWeek, mealType: meal.mealType,
                mealName: entry.name, servings: entry.servings ?? entry.grams! / catalogFood.servingSize,
                targetCalories: entry.nutrients.calories, targetProtein: entry.nutrients.protein,
                targetCarbs: entry.nutrients.carbs, targetFat: entry.nutrients.fat,
                status: isLogged ? 'LOGGED' : 'PENDING', loggedAt: isLogged ? at(day.date) : null,
                mealLogId: isLogged ? loggedId : null, createdAt: at(plan.weekStart) };
            }))) } } });
        remember('UserMealPlan', mealPlanId);
        plan.nutrition.days.forEach(day => day.meals.forEach(meal => meal.foods.forEach((entry, foodIndex) =>
          remember('UserMealPlanItem', id('meal-plan-item:' + day.date + ':' + meal.mealType + ':' + foodIndex)))));
      }
    }

    for (let index = 0; index < templates.length; index++) {
      const routineId = id('routine:' + index);
      if (await tx.workoutRoutine.findUnique({ where: { id: routineId } })) continue;
      const workout = workoutFor(addDays(weekDates(today)[0]!, index));
      const routine = routineSchema.parse({ name: 'Sample full body ' + ['A', 'B', 'C'][index],
        items: workout.exercises.map(entry => ({ workoutId: entry.exerciseId, targetSets: entry.sets,
          targetReps: String(entry.repsMin), targetWeight: entry.weightKg, restSeconds: entry.restSeconds,
          setTargets: { weightBasis: entry.weightBasis, weightUnit: entry.weightUnit, sets: entry.setPrescriptions } })) });
      await tx.workoutRoutine.create({ data: { id: routineId, userId, ...routine, items: routine.items } });
      remember('WorkoutRoutine', routineId);
    }
    // The receipt is written before commit: a write failure rolls the transaction back.
    const records = [...previousReceipt.records, ...created];
    await writeFile(receiptPath, JSON.stringify({ email, userId, seed, start, end: today, records,
      preservedBefore: before,
      note: 'Synthetic app-preview data. Existing records and account preferences were preserved.' }, null, 2));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });

  for (const original of before) {
    const rows = await (prisma[original.model] as any).findMany({
      where: { ...ownerWhere(original.model), id: { in: original.ids } }, orderBy: { id: 'asc' } });
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (hash !== original.hash) throw new Error('Existing records changed in ' + original.model + '; inspect the receipt.');
  }
  console.log('Verified all pre-existing records are unchanged.');

  try {
    const keys = await redis.keys('*' + userId + '*');
    if (keys.length) await redis.del(...keys);
    await redis.set('progress-revision:' + userId, seed + ':' + Date.now(), { ex: 86400 });
    console.log('Account caches cleared.');
  } catch { console.log('Database committed. Redis cache clearing was unavailable.'); }

  const [data, body, wellness, training, home] = await Promise.all([
    trainingData(userId, today), getBodyProgress(userId, { date: today, period: 'all', utcOffsetMinutes: 330 }),
    getWellnessProgress(userId, { date: today, period: 'all', utcOffsetMinutes: 330 }), getTrainingWeek(userId, today, 'en') as Promise<{ items: unknown[]; routines: unknown[] }>,
    getHomeData(userId, true, today),
  ]);
  const measurements = body.assessments.length;
  const checkIns = await prisma.dailyWellnessEntry.findMany({ where: { userId, date: { gte: start, lte: today } } });
  const scores = checkIns.map(entry => buildDailyReadiness(entry.date, user.wearableUsage, null, entry));
  if (!data.sets.length || !measurements || !wellness.nutrition.length || !training.items.length
      || scores.filter(Boolean).length < days.length - 1) throw new Error('Seed committed but an app readback check failed; inspect the receipt.');
  console.log(JSON.stringify({ created: created.length, receiptPath, verified: {
    sessions: data.sessions.length, loggedSets: data.sets.length,
    totalVolumeKg: rounded(data.sets.reduce((sum, row) => sum + (row.weight ?? 0) * row.reps, 0)),
    nutritionDays: wellness.nutrition.length, checkInDays: checkIns.length,
    readinessDays: scores.filter(Boolean).length, bodyMeasurements: measurements,
    weeklyPlans: await prisma.weeklyPersonalPlan.count({ where: { userId } }),
    savedRoutines: training.routines.length, todaysExercises: training.items.length,
    todayReadiness: home.readiness?.score, caloriesToday: home.nutrition.calories.consumed,
    waterToday: home.nutrition.water.consumed,
  } }, null, 2));
}

main().catch(error => {
  console.error(error?.name === 'Error' || error?.name === 'ZodError' ? error.message : 'Seed failed: ' + error?.name + ' ' + (error?.code ?? ''));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
