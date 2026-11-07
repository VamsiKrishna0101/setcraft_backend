import { DayOfWeek, Prisma } from '@prisma/client';
import prisma from '../../../config/prisma';
import redis from '../../../config/redis';
import { localizedExercise } from '../../../utils/fitness_locale';
import { formatExercise, exerciseSelect, invalidateUserWorkoutCache } from '../workout_service';
import { progressRevision } from '../../progress/progress_cache';
import { dateSchema, routineSchema, Targets, weekday, weekDates } from './session_types';
import { realPlanWhere, realCoachingNote } from '../../../utils/real_data';
import { prescribedWorkoutMinutes } from '../../../utils/workout_duration';

type Db = Prisma.TransactionClient;
const itemInclude = { workout: { select: exerciseSelect }, setLogs: { orderBy: { setNumber: 'asc' as const } } };
const planInclude = { items: { orderBy: { orderIndex: 'asc' as const }, include: itemInclude } };

export class WorkoutError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function invalidateTraining(userId: string) {
  await invalidateUserWorkoutCache(userId);
}

async function schedule(db: Db, userId: string, date?: string) {
  return db.userWorkout.findFirst({
    where: { userId, session: null, scheduledDate: null, status: { not: 'SKIPPED' }, AND: [realPlanWhere],
      ...(date ? { createdAt: { lt: new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000) } } : {}) },
    orderBy: { createdAt: 'desc' }, include: planInclude,
  });
}

async function currentDay(db: Db, userId: string, date: string) {
  const [session, setting] = await Promise.all([
    db.workoutSession.findUnique({
      where: { userId_date: { userId, date } }, include: { userWorkout: { include: planInclude } },
    }),
    db.workoutDay.findUnique({ where: { userId_date: { userId, date } } }),
  ]);
  const dated = session ? null : await db.userWorkout.findUnique({
    where: { userId_scheduledDate: { userId, scheduledDate: date } }, include: planInclude,
  });
  const plan = session?.userWorkout ?? dated ?? await schedule(db, userId, date);
  const items = plan?.items.filter(item => item.dayOfWeek === weekday(date) && item.sourceProvider === 'USER') ?? [];
  return { session, setting, plan, items, sourceIds: new Map<string, string>() };
}

// Reordered/replaced exercises must not display stale practice loads or names.
function currentWarmup(day: Awaited<ReturnType<typeof currentDay>>) {
  const first = day.items[0];
  const raw = day.plan?.warmup as {durationMinutes?: number; note?: string; steps?: Array<Record<string, unknown>>} | null;
  if (!first || !Array.isArray(raw?.steps)) return null;
  return {...raw, steps: raw.steps.map(step => step.exerciseId ? {
    ...step, exerciseId: first.workoutId, name: first.workout.name,
    weightKg: typeof step.weightKg === 'number' && first.targetWeight != null && first.targetWeight > step.weightKg
      ? step.weightKg : null,
  } : step)};
}

function formatDay(day: Awaited<ReturnType<typeof currentDay>>, date: string, locale: string) {
  const logs = day.items.flatMap(item => item.setLogs.filter(log =>
    `${log.year}-${log.month.padStart(2, '0')}-${log.day.padStart(2, '0')}` === date));
  const warmup = day.setting?.restDay ? null : currentWarmup(day);
  return {
    date, name: day.session?.name ?? day.setting?.name ?? 'Workout',
    restDay: day.setting?.restDay ?? false,
    session: day.session ? {
      id: day.session.id, status: day.session.status, startedAt: day.session.startedAt,
      finishedAt: day.session.finishedAt, durationSeconds: day.session.durationSeconds,
    } : null,
    planId: day.plan?.id ?? null,
    canReschedule: Boolean(day.plan?.scheduledDate && day.plan.status === 'NOT_STARTED' && !day.session && !day.setting?.restDay && day.items.length && day.items.every(item => item.status === 'NOT_STARTED' && !item.setLogs.length)),
    warmup,
    estimatedMinutes: day.setting?.restDay ? 0 : prescribedWorkoutMinutes(day.items, warmup?.durationMinutes ?? 0),
    items: day.items.map(item => ({
      ...item,
      status: day.session ? item.status : 'NOT_STARTED',
      completedAt: day.session ? item.completedAt : null,
      workout: localizedExercise(formatExercise(item.workout), locale),
      setLogs: day.session ? item.setLogs : [],
    })),
    summary: {
      sets: logs.length,
      volume: logs.reduce((sum, log) => sum + (log.weight ?? 0) * log.reps, 0),
      completed: day.session ? day.items.filter(item => item.status === 'COMPLETED').length : 0,
      skipped: day.session ? day.items.filter(item => item.status === 'SKIPPED').length : 0,
    },
  };
}

export async function getPlanForDate(userId: string, date: string) {
  const day = await currentDay(prisma, userId, date);
  if (!day.plan) return null;
  const formatted = formatDay(day, date, 'en');
  return { id: day.plan.id, weekLabel: day.plan.weekLabel,
    status: day.session?.status ?? (day.setting?.restDay ? 'REST_DAY' : 'NOT_STARTED'),
    aiNote: realCoachingNote(day.plan.aiNote),
    warmup: formatted.warmup,
    estimatedMinutes: formatted.estimatedMinutes,
    items: formatted.items.map((item, index) => ({ ...item, workout: formatExercise(day.items[index]!.workout) })) };
}

// Mutations return just the confirmed day. Week navigation and routines stay cached.
export async function getTrainingDay(userId: string, date: string, locale: string) {
  return formatDay(await currentDay(prisma, userId, date), date, locale);
}

export async function getTrainingWeek(userId: string, date: string, locale: string) {
  const revision = await progressRevision(userId);
  const key = `training:${userId}:${date}:${locale}:real-v5:${revision}`;
  try {
    const cached = await redis.get(key);
    if (cached) return cached;
  } catch {}
  const dates = weekDates(date);
  const [day, sessions, settings, plan, routines, datedPlans] = await Promise.all([
    currentDay(prisma, userId, date),
    prisma.workoutSession.findMany({ where: { userId, date: { in: dates } } }),
    prisma.workoutDay.findMany({ where: { userId, date: { in: dates } } }),
    schedule(prisma, userId, date),
    prisma.workoutRoutine.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.userWorkout.findMany({ where: { userId, scheduledDate: { in: dates } }, include: planInclude }),
  ]);
  const result = {
    ...formatDay(day, date, locale),
    week: dates.map(value => {
      const session = sessions.find(row => row.date === value);
      const rest = settings.find(row => row.date === value)?.restDay ?? false;
      const dated = datedPlans.find(row => row.scheduledDate === value);
      const count = (dated ?? plan)?.items.filter(item => item.dayOfWeek === weekday(value) && item.sourceProvider === 'USER').length ?? 0;
      return { date: value, status: session?.status ?? (rest ? 'REST_DAY' : count ? 'SCHEDULED' : 'EMPTY') };
    }),
    routines: routines.map(row => ({ id: row.id, name: row.name, count: (row.items as unknown[]).length })),
  };
  try { await redis.set(key, result, { ex: 60 }); } catch {}
  return result;
}

function requireToday(date: string, offset: number) {
  const today = new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
  if (date !== today) throw new WorkoutError('Start workouts on the current day.');
}

export async function startSession(userId: string, date: string, offset: number) {
  requireToday(date, offset);
  let result;
  try {
    result = await prisma.$transaction(async db => {
      await lockDay(db, userId, date);
      const day = await currentDay(db, userId, date);
      if (day.session) return day.session;
      if (day.setting?.restDay || !day.items.length) throw new WorkoutError('Add exercises before starting.');
      const snapshot = await db.userWorkout.create({
        data: {
          userId, weekLabel: date, status: 'IN_PROGRESS',
          warmup: day.plan?.warmup ?? Prisma.DbNull,
          items: { create: day.items.map(item => ({
            workoutId: item.workoutId, dayOfWeek: item.dayOfWeek, orderIndex: item.orderIndex,
            targetSets: item.targetSets, targetReps: item.targetReps, targetWeight: item.targetWeight,
            setTargets: item.setTargets ?? Prisma.DbNull,
            targetRpe: item.targetRpe, restSeconds: item.restSeconds, sourceProvider: 'USER',
          })) },
        },
      });
      return db.workoutSession.create({
        data: { userId, date, name: day.setting?.name ?? 'Workout', userWorkoutId: snapshot.id },
      });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    result = await prisma.workoutSession.findUnique({ where: { userId_date: { userId, date } } });
  }
  await invalidateTraining(userId);
  return result;
}

async function editable(db: Db, userId: string, date: string, allowCompleted = false) {
  await lockDay(db, userId, date);
  const day = await currentDay(db, userId, date);
  if (day.session?.status === 'COMPLETED' && !allowCompleted) throw new WorkoutError('This workout is already finished.', 409);
  if (!day.session && !day.plan?.scheduledDate) {
    const plan = await db.userWorkout.create({
      data: { userId, weekLabel: date, scheduledDate: date,
        warmup: day.plan?.warmup ?? Prisma.DbNull,
        items: { create: day.items.map(item => ({
          workoutId: item.workoutId, dayOfWeek: item.dayOfWeek, orderIndex: item.orderIndex,
          targetSets: item.targetSets, targetReps: item.targetReps, targetWeight: item.targetWeight,
          setTargets: item.setTargets ?? Prisma.DbNull,
          targetRpe: item.targetRpe, restSeconds: item.restSeconds, sourceProvider: 'USER',
        })) } }, include: planInclude,
    });
    day.items.forEach((item, index) => day.sourceIds.set(item.id, plan.items[index]!.id));
    return { ...day, plan, items: plan.items };
  }
  return day;
}

async function lockDay(db: Db, userId: string, date: string) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${date}))::text`;
}

export async function updateDay(userId: string, date: string, input: { name?: string; restDay?: boolean }) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date);
    if (day.session && input.restDay) throw new WorkoutError('A started workout cannot become a rest day.');
    await db.workoutDay.upsert({ where: { userId_date: { userId, date } }, create: { userId, date, ...input }, update: input });
    if (day.session && input.name) await db.workoutSession.update({ where: { id: day.session.id }, data: { name: input.name } });
  });
  await invalidateTraining(userId);
}

export async function addSessionItem(userId: string, date: string, input: Targets) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date);
    const exercise = await db.workout.findUnique({ where: { id: input.workoutId }, select: { id: true, coachingMetadata:true, catalogStatus:true } });
    if (!exercise) {
      throw new WorkoutError('Exercise not found.', 404);
    }
    if(exercise.catalogStatus==='STAGED')throw new WorkoutError('This exercise is awaiting review.');
    const modality=(exercise.coachingMetadata as {exerciseType?:string}|null)?.exerciseType;
    if(modality&&!['weight_reps','bodyweight_reps'].includes(modality))throw new WorkoutError('This exercise uses time, distance, or assistance rather than standard load-and-repetition logging.');
    const plan = day.plan ?? await db.userWorkout.create({ data: { userId, weekLabel: 'Custom Plan' } });
    await db.userWorkoutItem.create({ data: {
      ...input, userWorkoutId: plan.id, dayOfWeek: weekday(date) as DayOfWeek,
      orderIndex: Math.max(-1, ...day.items.map(item => item.orderIndex)) + 1,
    } });
    await db.workoutDay.upsert({ where: { userId_date: { userId, date } }, create: { userId, date }, update: { restDay: false } });
  });
  await invalidateTraining(userId);
}

export async function mutateItem(userId: string, date: string, itemId: string, action: 'replace' | 'remove' | 'status' | 'targets', input: any) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date);
    itemId = day.sourceIds.get(itemId) ?? itemId;
    const item = day.items.find(row => row.id === itemId);
    if (!item) throw new WorkoutError('Exercise not found.', 404);
    if ((action === 'replace' || action === 'remove') && item.setLogs.length) {
      throw new WorkoutError('Keep exercises with logged sets. Skip them instead.');
    }
    if (action === 'status' && !day.session) throw new WorkoutError('Start your workout first.');
    if (action === 'status' && input.status === 'COMPLETED' && !item.setLogs.some(log =>
      `${log.year}-${log.month.padStart(2, '0')}-${log.day.padStart(2, '0')}` === date)) {
      throw new WorkoutError('Log at least one set before marking this exercise done.');
    }
    if (action === 'status' && input.status === 'COMPLETED') validateLoggedLoad(item, item.setLogs);
    if (action === 'remove') {
      await db.userWorkoutItem.delete({ where: { id: itemId } });
    } else {
      if (action === 'replace' && !await db.workout.findUnique({ where: { id: input.workoutId }, select: { id: true } })) {
        throw new WorkoutError('Exercise not found.', 404);
      }
      const data = action === 'status'
        ? { status: input.status, completedAt: input.status === 'COMPLETED' ? new Date() : null }
        : { ...input, setTargets: input.setTargets ?? Prisma.DbNull,
            ...(action === 'replace' ? { status: 'NOT_STARTED', completedAt: null } : {}) };
      await db.userWorkoutItem.update({ where: { id: itemId }, data });
    }
  });
  await invalidateTraining(userId);
}

export async function reorderItems(userId: string, date: string, ids: string[]) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date);
    ids = ids.map(id => day.sourceIds.get(id) ?? id);
    if (new Set(ids).size !== ids.length || ids.length !== day.items.length || ids.some(id => !day.items.some(row => row.id === id))) {
      throw new WorkoutError('Include each exercise exactly once.');
    }
    for (const [index, id] of ids.entries()) await db.userWorkoutItem.update({ where: { id }, data: { orderIndex: index } });
  });
  await invalidateTraining(userId);
}

export async function saveSessionSet(userId: string, date: string, itemId: string, input: { setNumber: number; reps: number; weight: number | null; rpe: number | null }) {
  const result = await prisma.$transaction(async db => {
    const day = await editable(db, userId, date, true);
    const item = day.items.find(row => row.id === itemId);
    if (!day.session || !item) throw new WorkoutError('Start your workout before logging sets.');
    validateLoggedLoad(item, [input]);
    const [year, month, dayNumber] = date.split('-');
    const key = `${userId}:${day.session.id}:${itemId}:${input.setNumber}`;
    return db.workoutSetLog.upsert({
      where: { clientKey: key },
      create: { ...input, clientKey: key, userId, userWorkoutItemId: itemId, year: year!, month: month!, day: dayNumber! },
      update: { reps: input.reps, weight: input.weight, rpe: input.rpe },
    });
  });
  await invalidateTraining(userId);
  return result;
}

function validateLoggedLoad(item: {workout: {equipment: string; coachingMetadata: unknown}}, sets: Array<{weight: number | null}>) {
  const modality = (item.workout.coachingMetadata as {exerciseType?: string} | null)?.exerciseType;
  const bodyweight = modality === 'bodyweight_reps' || (!modality &&
    item.workout.equipment.toLowerCase().replace(/[\s_-]/g, '') === 'bodyweight');
  if (!bodyweight && sets.some(set => set.weight == null || set.weight <= 0)) {
    throw new WorkoutError('Enter the weight you lifted before saving this set.');
  }
}

export async function completeItem(userId: string, date: string, itemId: string,
  sets: Array<{ setNumber: number; reps: number; weight: number | null; rpe: number | null }>) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date, true);
    const item = day.items.find(row => row.id === itemId);
    if (!day.session || !item) throw new WorkoutError('Start your workout before logging sets.');

    if (day.session.status === 'COMPLETED') {
      const matches = sets.every(set => item.setLogs.some(log =>
        log.clientKey === userId + ':' + day.session!.id + ':' + itemId + ':' + set.setNumber &&
        log.reps === set.reps && log.weight === set.weight && log.rpe === set.rpe));
      if (item.status === 'COMPLETED' && matches) return;
      throw new WorkoutError('This workout is already finished. Reopen it to edit logged sets.', 409);
    }

    const [year, month, dayNumber] = date.split('-');
    const logged = item.setLogs.some(log =>
      `${log.year}-${log.month.padStart(2, '0')}-${log.day.padStart(2, '0')}` === date);
    if (!logged && !sets.length) throw new WorkoutError('Log at least one set before marking this exercise done.');
    validateLoggedLoad(item, [
      ...item.setLogs.filter(log => !sets.some(set => set.setNumber === log.setNumber)), ...sets,
    ]);

    for (const set of sets) {
      const clientKey = `${userId}:${day.session.id}:${itemId}:${set.setNumber}`;
      await db.workoutSetLog.upsert({
        where: { clientKey },
        create: { ...set, clientKey, userId, userWorkoutItemId: itemId, year: year!, month: month!, day: dayNumber! },
        update: { reps: set.reps, weight: set.weight, rpe: set.rpe },
      });
    }

    await db.userWorkoutItem.update({
      where: { id: itemId },
      data: { status: 'COMPLETED', completedAt: item.completedAt ?? new Date() },
    });
  });

  await invalidateTraining(userId);
}

export async function deleteSessionSet(userId: string, date: string, itemId: string, number: number) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date, true);
    if (!day.session || !day.items.some(row => row.id === itemId)) throw new WorkoutError('Exercise not found.', 404);
    const [year, month, dayNumber] = date.split('-');
    await db.workoutSetLog.deleteMany({ where: { userId, userWorkoutItemId: itemId, setNumber: number,
      year, month: { in: [month!, String(Number(month))] }, day: { in: [dayNumber!, String(Number(dayNumber))] } } });
  });
  await invalidateTraining(userId);
}

export async function finishSession(userId: string, date: string) {
  await prisma.$transaction(async db => {
    await lockDay(db, userId, date);
    const day = await currentDay(db, userId, date);
    if (!day.session) throw new WorkoutError('No workout in progress.', 404);
    if (day.session.status === 'COMPLETED') return;
    if (day.items.some(item => !['COMPLETED', 'SKIPPED'].includes(item.status))) {
      throw new WorkoutError('Mark each exercise done or skipped before finishing.');
    }
    for (const item of day.items.filter(item => item.status === 'COMPLETED')) {
      if (!item.setLogs.length) throw new WorkoutError('Log at least one set before marking this exercise done.');
      validateLoggedLoad(item, item.setLogs);
    }
    const now = new Date();
    await db.workoutSession.update({ where: { id: day.session.id }, data: {
      status: 'COMPLETED', finishedAt: now,
      durationSeconds: Math.max(0, Math.floor((now.getTime() - day.session.startedAt.getTime()) / 1000)),
    } });
    await db.userWorkout.update({ where: { id: day.session.userWorkoutId }, data: { status: 'COMPLETED' } });
  });
  await invalidateTraining(userId);
}

export async function previousPerformance(userId: string, workoutId: string, before: string) {
  const logs = await prisma.workoutSetLog.findMany({
    where: { userId, workoutItem: { workoutId, sourceProvider: 'USER', userWorkout: { userId } } },
    orderBy: { createdAt: 'desc' }, take: 500,
  });
  const previous = logs.filter(log => {
    const date = `${log.year}-${log.month.padStart(2, '0')}-${log.day.padStart(2, '0')}`;
    return dateSchema.safeParse(date).success && date < before;
  });
  const last = previous[0];
  if (!last) return { date: null, sets: [] };
  return { date: `${last.year}-${last.month.padStart(2, '0')}-${last.day.padStart(2, '0')}`,
    sets: previous.filter(log => log.userWorkoutItemId === last.userWorkoutItemId && log.day === last.day && log.month === last.month && log.year === last.year)
      .sort((a, b) => a.setNumber - b.setNumber) };
}

export async function saveRoutine(userId: string, input: ReturnType<typeof routineSchema.parse>) {
  const count = await prisma.workout.count({ where: { id: { in: [...new Set(input.items.map(item => item.workoutId))] } } });
  if (count !== new Set(input.items.map(item => item.workoutId)).size) throw new WorkoutError('Exercise not found.', 404);
  const result = await prisma.workoutRoutine.create({ data: { userId, name: input.name, items: input.items } });
  await invalidateTraining(userId);
  return result;
}

export async function deleteRoutine(userId: string, id: string) {
  const result = await prisma.workoutRoutine.deleteMany({ where: { id, userId } });
  if (!result.count) throw new WorkoutError('Routine not found.', 404);
  await invalidateTraining(userId);
}

export async function applyRoutine(userId: string, date: string, id: string) {
  await prisma.$transaction(async db => {
    const day = await editable(db, userId, date);
    if (day.session) throw new WorkoutError('Use routines before starting your workout.');
    const routine = await db.workoutRoutine.findFirst({ where: { id, userId } });
    if (!routine) throw new WorkoutError('Routine not found.', 404);
    const input = routineSchema.parse({ name: routine.name, items: routine.items });
    if (day.items.some(item => item.setLogs.length)) throw new WorkoutError('This schedule contains historical sets. Create a new workout instead.');
    const plan = day.plan ?? await db.userWorkout.create({ data: { userId, weekLabel: 'Custom Plan' } });
    await db.userWorkoutItem.deleteMany({ where: { userWorkoutId: plan.id, dayOfWeek: weekday(date) as DayOfWeek } });
    await db.userWorkoutItem.createMany({ data: input.items.map((item, index) => ({
      ...item, setTargets: item.setTargets ?? Prisma.DbNull, userWorkoutId: plan.id, dayOfWeek: weekday(date) as DayOfWeek, orderIndex: index,
    })) });
    await db.workoutDay.upsert({ where: { userId_date: { userId, date } },
      create: { userId, date, name: routine.name }, update: { name: routine.name, restDay: false } });
  });
  await invalidateTraining(userId);
}

export async function getRoutine(userId: string, id: string, locale: string) {
  const routine = await prisma.workoutRoutine.findFirst({ where: { id, userId } });
  if (!routine) throw new WorkoutError('Routine not found.', 404);
  const input = routineSchema.parse({ name: routine.name, items: routine.items });
  const exercises = await prisma.workout.findMany({
    where: { id: { in: input.items.map(item => item.workoutId) } }, select: exerciseSelect,
  });
  return { id: routine.id, name: routine.name, items: input.items.map((item, index) => {
    const exercise = exercises.find(exercise => exercise.id === item.workoutId);
    if (!exercise) throw new WorkoutError('Exercise not found.', 404);
    return { ...item, id: item.workoutId + ':' + index, orderIndex: index,
      workout: localizedExercise(formatExercise(exercise), locale) };
  }) };
}

export async function updateRoutine(userId: string, id: string, input: ReturnType<typeof routineSchema.parse>) {
  const exercises = await prisma.workout.count({ where: { id: { in: input.items.map(item => item.workoutId) } } });
  if (exercises !== new Set(input.items.map(item => item.workoutId)).size) throw new WorkoutError('Exercise not found.', 404);
  const result = await prisma.workoutRoutine.updateMany({ where: { id, userId },
    data: { name: input.name, items: input.items } });
  if (!result.count) throw new WorkoutError('Routine not found.', 404);
  await invalidateTraining(userId);
}
