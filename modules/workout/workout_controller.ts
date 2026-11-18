import { Request, Response, NextFunction } from "express";
import { DayOfWeek } from "@prisma/client";
import { addSessionItem, getPlanForDate } from './session/session_service';
import redis from '../../config/redis';
import { dateSchema, weekday } from './session/session_types';
import { appLocale } from '../../utils/app_locale';
import { localizedExercise, localizedCoaching } from '../../utils/fitness_locale';
import { exercisePageQuery, getExercisePage } from './exercise_catalog';
import {
    createExercise,
    catalogExerciseSelect,
    formatExercise,
    getAllExercises,
    getExerciseById,
    updateExercise,
    deleteExercise,
    getUserWorkouts,
    markItemComplete,
    markItemSkip,
    updateWorkoutItem,
    resolveAddedExercise,
    localDateForWeekday,
    deleteWorkoutItem,
    markWorkoutComplete,
    logSet,
    getPreviousSets,
} from "./workout_service";
import { ExerciseSchema, AddWorkoutItemSchema, UpdateWorkoutItemSchema, LogSetSchema } from "./workout_types";

// ─── POST /api/workout/exercises ─────────────────────── ADMIN only ──────────
export async function handleCreateExercise(req: Request, res: Response, next: NextFunction) {
    const parsed = ExerciseSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const exercise = await createExercise(parsed.data);
        res.status(201).json({ message: "Exercise created", data: exercise });
    } catch (e) {
        next(e);
    }
}

// ─── GET /api/workout/exercises ──────────────────────── Authenticated ────────
export async function handleGetAllExercises(req: Request, res: Response, next: NextFunction) {
    try {
        if (req.query.page !== undefined || req.query.pageSize !== undefined) {
            const parsed = exercisePageQuery.safeParse(req.query);
            if (!parsed.success) {
                res.status(400).json({ error: parsed.error.flatten() });
                return;
            }
            const result = await getExercisePage(parsed.data, appLocale(req.headers['accept-language']),
                { ...catalogExerciseSelect, description: false, instructions: false }, formatExercise);
            res.status(200).json(result);
            return;
        }
        const { category, bodyPart, difficulty, trainingLocation, equipment, target, search } = req.query as Record<string, string>;
        const exercises = await getAllExercises({ category, bodyPart, difficulty, trainingLocation, equipment, target, search }, appLocale(req.headers['accept-language']));
        res.status(200).json({ data: exercises });
    } catch (e) {
        next(e);
    }
}

// ─── GET /api/workout/exercises/:id ─────────────────── Authenticated ────────
export async function handleGetExerciseById(req: Request, res: Response, next: NextFunction) {
    const id = req.params.id as string;
    try {
        const mediaGender = req.query.mediaGender;
        if (mediaGender !== undefined && mediaGender !== 'male' && mediaGender !== 'female') {
            res.status(400).json({ error: 'Invalid demo filter' });
            return;
        }
        const exercise = await getExerciseById(id, appLocale(req.headers['accept-language']), mediaGender);
        res.status(200).json({ data: exercise });
    } catch (e) {
        next(e);
    }
}

// ─── PATCH /api/workout/exercises/:id ────────────────── ADMIN only ──────────
export async function handleUpdateExercise(req: Request, res: Response, next: NextFunction) {
    const id = req.params.id as string;
    const parsed = ExerciseSchema.partial().safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const exercise = await updateExercise(id, parsed.data);
        res.status(200).json({ message: "Exercise updated", data: exercise });
    } catch (e) {
        next(e);
    }
}

// ─── DELETE /api/workout/exercises/:id ───────────────── ADMIN only ──────────
export async function handleDeleteExercise(req: Request, res: Response, next: NextFunction) {
    const id = req.params.id as string;
    try {
        const result = await deleteExercise(id);
        res.status(200).json(result);
    } catch (e) {
        next(e);
    }
}

// ─── GET /api/workout/me/:day ─────────────────────────── Authenticated ───────
export async function handleGetUserWorkouts(req: Request, res: Response, next: NextFunction) {
    const rawDay = req.params.day;
    const day = (typeof rawDay === "string" ? rawDay : "")?.toUpperCase() as DayOfWeek;
    const validDays = Object.values(DayOfWeek);
    if (!validDays.includes(day)) {
        res.status(400).json({ error: `Invalid day. Must be one of: ${validDays.join(", ")}` });
        return;
    }
    const userId = req.user?.userId || (req as any).user?.id;
    const weekLabel = req.query.weekLabel as string | undefined;
    const date = req.query.date;
    if (date !== undefined && (!dateSchema.safeParse(date).success || weekday(date as string) !== day)) {
        res.status(400).json({ error: 'Invalid workout date' });
        return;
    }
    try {
        const data = date ? await getPlanForDate(userId, date as string) : await getUserWorkouts(userId, day, weekLabel);
        const locale = appLocale(req.headers['accept-language']);
        res.status(200).json({ data: data ? { ...data,
            aiNote: await localizedCoaching(data.aiNote, locale, userId),
            items: data.items.map((item: any) => ({ ...item, workout: localizedExercise(item.workout, locale) })) } : null });
    } catch (e) {
        next(e);
    }
}

export async function handleMarkItemComplete(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const { itemId } = req.params as Record<string, string>;
    try {
        const data = await markItemComplete(userId, itemId);
        res.status(200).json({ message: "Exercise marked complete", data });
    } catch (e) {
        next(e);
    }
}

export async function handleMarkItemSkip(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const { itemId } = req.params as Record<string, string>;
    try {
        const data = await markItemSkip(userId, itemId);
        res.status(200).json({ message: "Exercise skipped", data });
    } catch (e) {
        next(e);
    }
}

export async function handleUpdateWorkoutItem(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const { itemId } = req.params as Record<string, string>;
    const parsed = UpdateWorkoutItemSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.format() });
        return;
    }
    try {
        const data = await updateWorkoutItem(userId, itemId, parsed.data);
        res.status(200).json({ message: "Exercise updated", data: { ...data, workout: localizedExercise(data.workout, appLocale(req.headers['accept-language'])) } });
    } catch (e) {
        next(e);
    }
}

export async function handleAddWorkoutItem(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const parsed = AddWorkoutItemSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.format() });
        return;
    }
    try {
        // Same path as the Train tab: it adds to a started session, a dated
        // plan or a new plan for today, and refuses a finished workout.
        const input = parsed.data;
        const workoutId = await resolveAddedExercise(input);
        await addSessionItem(userId, localDateForWeekday(input.dayOfWeek), {
            workoutId,
            targetSets: input.targetSets,
            targetReps: input.targetReps,
            targetWeight: input.targetWeight ?? 0,
            restSeconds: input.restSeconds,
        });
        await redis.del(`home:${userId}`).catch(() => null);
        res.status(201).json({ message: "Exercise added to today's plan", data: { workoutId } });
    } catch (e) {
        next(e);
    }
}

export async function handleDeleteWorkoutItem(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const { itemId } = req.params as Record<string, string>;
    try {
        const data = await deleteWorkoutItem(userId, itemId);
        res.status(200).json(data);
    } catch (e) {
        next(e);
    }
}

export async function handleMarkWorkoutComplete(req: Request, res: Response, next: NextFunction) {
    const userId = (req.user?.userId || (req as any).user?.id) as string;
    const { workoutId } = req.params as Record<string, string>;
    try {
        const data = await markWorkoutComplete(userId, workoutId);
        res.status(200).json({ message: "Workout completed", data });
    } catch (e) {
        next(e);
    }
}

export async function handleLogSet(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    const parsed = LogSetSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    try {
        const data = await logSet(userId, parsed.data);
        res.status(201).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetPreviousSets(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    const raw = req.query.itemIds;
    const itemIds: string[] = Array.isArray(raw)
        ? (raw as string[])
        : typeof raw === "string"
        ? [raw]
        : [];
    try {
        const data = await getPreviousSets(userId, itemIds);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}
