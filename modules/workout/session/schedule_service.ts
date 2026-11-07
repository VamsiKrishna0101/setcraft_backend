import { createHash } from 'node:crypto';
import { DayOfWeek, Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../config/prisma';
import { addDays, dateInZone } from '../../../graphworkflow/common/types';
import { mondayOf } from '../../../graphworkflow/common/calendar_schedule';
import { invalidateUserWorkoutCache } from '../workout_service';
import { dateSchema, weekday, weekDates } from './session_types';
import { WorkoutError } from './session_service';
import { ScheduleMove, shiftPendingWorkouts } from './schedule_engine';

export const scheduleRequest = z.object({
  timezone: z.string().min(1).max(80),
  action: z.enum(['SHIFT', 'SKIP']).default('SHIFT'),
  availableDates: z.array(dateSchema).max(6).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  allowSkip: z.boolean().default(false),
}).strict();
type Request = z.infer<typeof scheduleRequest>;
type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function prepare(db: Db, userId: string, date: string, input: Request, now: Date) {
  let today: string;
  try { today = dateInZone(input.timezone, now); } catch { throw new WorkoutError('Choose a valid timezone.'); }
  if (date !== today) throw new WorkoutError('Rest today is available for the current local date only.');
  const week = weekDates(date);
  const remaining = week.filter(value => value >= date);
  const [rows, sessions, settings, profile, plan] = await Promise.all([
    db.userWorkout.findMany({where: {userId, scheduledDate: {in: remaining}}, orderBy: {scheduledDate: 'asc'}, include: {items: {orderBy: {orderIndex: 'asc'}, include: {setLogs: {select: {id: true}}}}, session: true}}),
    db.workoutSession.findMany({where: {userId, date: {in: remaining}}, orderBy: {date: 'asc'}}),
    db.workoutDay.findMany({where: {userId, date: {in: remaining}}, orderBy: {date: 'asc'}}),
    db.onboarding.findUnique({where: {userId}, select: {trainingDays: true}}),
    db.weeklyPersonalPlan.findFirst({where: {userId, status: 'ACTIVE', weekStart: {lte: date, gte: addDays(date, -6)}}, orderBy: {activatedAt: 'desc'}, select: {id: true}}),
  ]);
  const locked = new Set(sessions.map(row => row.date));
  for (const row of rows) if (row.status !== 'NOT_STARTED' || row.session || row.items.some(item => item.status !== 'NOT_STARTED' || item.setLogs.length)) locked.add(row.scheduledDate!);
  const source = rows.find(row => row.scheduledDate === date);
  if (!source?.items.length || locked.has(date) || settings.find(row => row.date === date)?.restDay) {
    throw new WorkoutError('Only an unstarted scheduled workout can be moved or skipped. Started and completed workouts stay unchanged.', 409);
  }
  const candidates = remaining.filter(value => value > date && !locked.has(value));
  const preferred = profile?.trainingDays ?? [];
  const defaults = candidates.filter(value => !preferred.length || preferred.includes(weekday(value)) || rows.some(row => row.scheduledDate === value));
  const available = [...(input.availableDates ?? defaults)].sort();
  if (new Set(available).size !== available.length || available.some(value => !candidates.includes(value))) throw new WorkoutError('Choose available dates after today and no later than Sunday.');
  const pending = rows.filter(row => !locked.has(row.scheduledDate!) && row.items.length && !settings.find(setting => setting.date === row.scheduledDate)?.restDay);
  const changes = shiftPendingWorkouts(pending.map(row => ({id: row.id, date: row.scheduledDate!, name: settings.find(setting => setting.date === row.scheduledDate)?.name ?? 'Workout'})), available, input.action === 'SKIP');
  const fingerprint = createHash('sha256').update(JSON.stringify({userId, date, action: input.action, available, rows, sessions, settings, plan})).digest('hex');
  return {date, weekEnd: week[6]!, candidateDates: candidates, availableDates: available, changes, fingerprint, planId: plan?.id ?? null, rows};
}

export async function previewSchedule(userId: string, date: string, input: Request, now = new Date()) {
  const {rows: _, ...preview} = await prepare(prisma, userId, date, input, now);
  return preview;
}

export async function applySchedule(userId: string, date: string, input: Request, now = new Date()) {
  if (!input.fingerprint) throw new WorkoutError('Review the updated dates before applying them.');
  const result = await prisma.$transaction(async db => {
    await db.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    const previous = await db.workoutScheduleChange.findUnique({where: {userId_fingerprint: {userId, fingerprint: input.fingerprint!}}});
    if (previous) return {changes: previous.changes, alreadyApplied: true};
    // Match the same locks used by session starts and exercise edits.
    for (const value of weekDates(date)) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${value}))::text`;
    const preview = await prepare(db, userId, date, input, now);
    if (preview.fingerprint !== input.fingerprint) throw new WorkoutError('Your schedule changed. Review the updated dates again.', 409);
    if (preview.changes.some(row => !row.toDate) && !input.allowSkip) throw new WorkoutError('Confirm the listed skipped workouts before applying this change.', 409);
    const ids = preview.changes.map(row => row.workoutId);
    // Release unique date slots together, then reassign. No workout or log is deleted.
    await db.userWorkout.updateMany({where: {userId, id: {in: ids}}, data: {scheduledDate: null}});
    for (const change of preview.changes) {
      await db.workoutDay.upsert({where: {userId_date: {userId, date: change.fromDate}}, create: {userId, date: change.fromDate, name: 'Rest day', restDay: true}, update: {name: 'Rest day', restDay: true}});
    }
    for (const change of preview.changes) {
      if (change.toDate) {
        await db.userWorkout.update({where: {id: change.workoutId}, data: {scheduledDate: change.toDate}});
        await db.userWorkoutItem.updateMany({where: {userWorkoutId: change.workoutId}, data: {dayOfWeek: weekday(change.toDate) as DayOfWeek}});
        await db.workoutDay.upsert({where: {userId_date: {userId, date: change.toDate}}, create: {userId, date: change.toDate, name: change.name, restDay: false}, update: {name: change.name, restDay: false}});
      } else {
        await db.userWorkout.update({where: {id: change.workoutId}, data: {status: 'SKIPPED'}});
        await db.userWorkoutItem.updateMany({where: {userWorkoutId: change.workoutId}, data: {status: 'SKIPPED'}});
      }
    }
    await db.workoutScheduleChange.create({data: {userId, planId: preview.planId, weekStart: mondayOf(date), fromDate: date, action: input.action, fingerprint: preview.fingerprint, changes: json(preview.changes)}});
    return {changes: preview.changes, alreadyApplied: false};
  }, {timeout: 20000});
  await invalidateUserWorkoutCache(userId);
  return result;
}

// Return the effective dates while leaving the original generated payload intact.
export async function effectivePlan<T extends {id?: string; payload: unknown}>(userId: string, plan: T): Promise<T> {
  if (!plan.id || !plan.payload || typeof plan.payload !== 'object') return plan;
  const history = await prisma.workoutScheduleChange.findMany({where: {userId, planId: plan.id}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
  if (!history.length) return plan;
  const payload = JSON.parse(JSON.stringify(plan.payload));
  for (const entry of history) {
    const changes = entry.changes as unknown as ScheduleMove[];
    const original = new Map<string, unknown>(changes.map(change => [change.fromDate, payload.workouts.find((day: {date: string}) => day.date === change.fromDate)]));
    for (const change of changes) {
      const index = payload.workouts.findIndex((day: {date: string}) => day.date === change.fromDate);
      if (index >= 0) payload.workouts[index] = {date: change.fromDate, name: 'Rest day', restDay: true, estimatedMinutes: 0, exercises: []};
    }
    for (const change of changes) if (change.toDate && original.get(change.fromDate)) {
      const index = payload.workouts.findIndex((day: {date: string}) => day.date === change.toDate);
      if (index >= 0) payload.workouts[index] = {...original.get(change.fromDate) as object, date: change.toDate};
    }
  }
  payload.scheduleChanges = history.map(row => ({date: row.fromDate, changes: row.changes}));
  return {...plan, payload};
}
