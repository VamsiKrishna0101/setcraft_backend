import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { isRealBodyEntry, realMealWhere } from '../../utils/real_data';
import { McpError, McpPrincipal, McpScope } from './mcp_tokens';

type Db = Prisma.TransactionClient;
const day = z.iso.date().refine(v => v >= '2000-01-01' && v <= '2100-12-31');
const range = {from: day.optional(), to: day.optional()};
const paged = z.object({...range, page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(10).default(5)}).strict();
export function dateRange(args: {from?: string; to?: string}) {
  const to = args.to ?? new Date().toISOString().slice(0, 10);
  const from = args.from ?? new Date(Date.parse(to) - 27 * 86400000).toISOString().slice(0, 10);
  if (from > to || Date.parse(to) - Date.parse(from) > 89 * 86400000) throw new McpError(400, 'DATE_RANGE', 'Choose a date range of at most 90 days.');
  return {from, to};
}
type Tool = {name: string; description: string; scope?: McpScope; schema: z.ZodObject;
  read: (db: Db, userId: string, args: any) => Promise<unknown>};
const exerciseSelect = {id: true, name: true, bodyPart: true, target: true, secondaryMuscles: true, equipment: true} as const;
export const mcpTools: Tool[] = [
  {name: 'get_connected_account', description: 'Identify the Setcraft account associated with this connection. No email, password or billing details.', schema: z.object({}).strict(),
    read: async (db, userId) => {
      const p = await db.onboarding.findUnique({where: {userId}, select: {name: true}});
      return {id: userId, ...(p?.name ? {name: p.name} : {})};
    }},
  {name: 'get_training_profile', scope: 'training:read', description: 'Read training goals, experience, equipment and availability. Excludes measurements, medical notes and wearable data.', schema: z.object({}).strict(),
    read: (db, userId) => db.onboarding.findUnique({where: {userId}, select: {workingToward: true, experience: true, daysPerWeek: true,
      workoutDuration: true, trainingLocation: true, equipment: true, trainingDays: true, trainingSplit: true, focusMuscles: true}})},
  {name: 'get_weekly_workouts', scope: 'plans:read', description: 'Read saved scheduled workouts for one Monday–Sunday week. These prescriptions are plans, not logged performance. No nutrition or private coaching notes.',
    schema: z.object({weekStart: day.refine(v => new Date(v).getUTCDay() === 1, 'Choose a Monday.')}).strict(),
    read: async (db, userId, {weekStart}) => {
      const end = new Date(Date.parse(weekStart) + 6 * 86400000).toISOString().slice(0, 10);
      const workouts = await db.userWorkout.findMany({where: {userId, scheduledDate: {gte: weekStart, lte: end}, items: {some: {sourceProvider: 'USER'}}},
        orderBy: {scheduledDate: 'asc'}, take: 7, select: {id: true, scheduledDate: true, status: true, items: {
          where: {sourceProvider: 'USER'}, take: 20, orderBy: {orderIndex: 'asc'}, select: {id: true, targetSets: true,
            targetReps: true, targetWeight: true, targetRpe: true, restSeconds: true, status: true, workout: {select: exerciseSelect}}}}});
      const restDays = await db.workoutDay.findMany({where: {userId, date: {gte: weekStart, lte: end}, restDay: true}, select: {date: true}, take: 7});
      return {weekStart, weekEnd: end, kind: 'planned_prescriptions', weightUnit: 'kg', workouts, restDays};
    }},
  {name: 'get_workout_history', scope: 'workouts:read', description: 'Read recorded workout sessions and actual sets/reps/weights with dates. Paginated; returns only this account, no preview workouts or free-text notes.', schema: paged,
    read: async (db, userId, args) => {
      const window = dateRange(args);
      const rows = await db.workoutSession.findMany({where: {userId, date: {gte: window.from, lte: window.to}},
        orderBy: [{date: 'desc'}, {id: 'desc'}], skip: (args.page - 1) * args.limit, take: args.limit + 1,
        select: {date: true, status: true, durationSeconds: true, userWorkout: {select: {items: {where: {sourceProvider: 'USER'}, take: 20,
          orderBy: {orderIndex: 'asc'}, select: {workout: {select: exerciseSelect}, setLogs: {where: {userId}, take: 30,
            orderBy: {setNumber: 'asc'}, select: {setNumber: true, reps: true, weight: true, rpe: true}}}}}}}});
      return {...window, weightUnit: 'kg', page: args.page, hasMore: rows.length > args.limit, sessions: rows.slice(0, args.limit)};
    }},
  {name: 'get_training_progress', scope: 'workouts:read', description: 'Compute actual logged sets, reps and lifted weight volume for a bounded period. Does not estimate muscle growth or diagnose recovery.', schema: z.object(range).strict(),
    read: async (db, userId, args) => {
      const window = dateRange(args);
      const rows = await db.workoutSetLog.findMany({where: {userId, workoutItem: {sourceProvider: 'USER', userWorkout: {session: {date: {gte: window.from, lte: window.to}}}}},
        take: 5001, orderBy: {id: 'asc'}, select: {reps: true, weight: true, workoutItem: {select: {workout: {select: exerciseSelect}, userWorkout: {select: {session: {select: {date: true}}}}}}}});
      if (rows.length > 5000) throw new McpError(400, 'SMALLER_RANGE', 'Choose a shorter date range for this summary.');
      const groups = new Map<string, {exerciseId: string; name: string; sets: number; reps: number; volumeKg: number}>();
      for (const row of rows) {
        const ex = row.workoutItem.workout;
        const entry = groups.get(ex.id) ?? {exerciseId: ex.id, name: ex.name, sets: 0, reps: 0, volumeKg: 0};
        entry.sets++; entry.reps += row.reps; entry.volumeKg += (row.weight ?? 0) * row.reps; groups.set(ex.id, entry);
      }
      return {...window, recordedSets: rows.length, exercises: [...groups.values()].map(e => ({...e, volumeKg: Math.round(e.volumeKg * 10) / 10})),
        note: 'Volume is recorded external load × reps. Bodyweight and assisted movements are not comparable using this value alone.'};
    }},
  {name: 'get_exercise_details', description: 'Look up instructions, targeted muscles and equipment for an exercise ID in the Setcraft library. No personal data or media URLs.',
    schema: z.object({exerciseId: z.string().uuid()}).strict(), read: (db, _userId, {exerciseId}) => db.workout.findUnique({where: {id: exerciseId},
      select: {...exerciseSelect, instructions: true, difficulty: true, tips: true}})},
  {name: 'get_nutrition_summary', scope: 'nutrition:read', description: 'Read explicitly shared nutrition: logged intake plus separately labelled saved targets. No photos, medical notes or allergy history. Paginated; all nutrients are grams except calories in kcal.', schema: paged,
    read: async (db, userId, args) => {
      const window = dateRange(args);
      const dates = [];
      for (let t = Date.parse(window.from); t <= Date.parse(window.to); t += 86400000) {
        const d = new Date(t); dates.push({day: String(d.getUTCDate()), month: String(d.getUTCMonth() + 1), year: String(d.getUTCFullYear())});
        dates.push({day: String(d.getUTCDate()).padStart(2, '0'), month: String(d.getUTCMonth() + 1).padStart(2, '0'), year: String(d.getUTCFullYear())});
      }
      const rows = await db.userMealLog.findMany({where: {userId, ...realMealWhere, status: 'LOGGED', OR: dates},
        orderBy: [{createdAt: 'desc'}, {id: 'desc'}], skip: (args.page - 1) * args.limit, take: args.limit + 1,
        select: {day: true, month: true, year: true, mealType: true, calories: true, protein: true, carbs: true, fat: true, fiber: true}});
      const saved = await db.weeklyPersonalPlan.findFirst({where: {userId, synthetic: false, status: {in: ['ACTIVE', 'ARCHIVED']}, weekStart: {lte: window.to}},
        orderBy: [{weekStart: 'desc'}, {version: 'desc'}], select: {weekStart: true, payload: true}});
      // Whitelist numeric targets; never return the full plan or planner input.
      const targets = (saved?.payload as any)?.nutrition?.targets;
      const safeTargets = targets && typeof targets === 'object' ? Object.fromEntries(['calories', 'protein', 'carbs', 'fat'].filter(k => typeof targets[k] === 'number' && Number.isFinite(targets[k])).map(k => [k, targets[k]])) : null;
      return {...window, page: args.page, hasMore: rows.length > args.limit, loggedIntake: rows.slice(0, args.limit),
        savedTargetWeek: saved?.weekStart ?? null, savedDailyTargets: safeTargets};
    }},
  {name: 'get_measurement_trends', scope: 'measurements:read', description: 'Read manually entered body measurements and their units/sources. Excludes photos, visual ratings and inferred photo measurements.', schema: paged,
    read: async (db, userId, args) => {
      const window = dateRange(args);
      const rows = await db.bodyAssessment.findMany({where: {userId, status: 'SAVED', method: 'entered', recordedDate: {gte: window.from, lte: window.to}},
        orderBy: [{recordedDate: 'desc'}, {id: 'desc'}], take: args.limit + 1, skip: (args.page - 1) * args.limit,
        select: {recordedDate: true, metrics: true, analysisVersion: true, quality: true}});
      const entries = rows.slice(0, args.limit).filter(isRealBodyEntry).map(row => ({date: row.recordedDate,
        metrics: Object.fromEntries(Object.entries((row.metrics ?? {}) as Record<string, any>)
          .filter(([, m]) => ['tape', 'scale', 'smart_scale', 'dexa', 'calipers'].includes(m?.source))
          .map(([k, m]) => [k, {value: m.value, unit: m.unit, source: m.source}]))}));
      return {...window, page: args.page, hasMore: rows.length > args.limit, entries};
    }},
];

export async function readMcpTool(p: McpPrincipal, tool: Tool, raw: unknown) {
  if (tool.scope && !p.scopes.includes(tool.scope)) throw new McpError(403, 'INSUFFICIENT_SCOPE', 'This token does not allow that data. Create a token with the required permission.');
  const args = tool.schema.parse(raw ?? {});
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '7000ms'");
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tool.read(tx, p.userId, args);
  }, {maxWait: 2000, timeout: 10000});
  if (Buffer.byteLength(JSON.stringify(result)) > 100000) throw new McpError(400, 'SMALLER_PAGE', 'Request a smaller page or shorter date range.');
  return result;
}
