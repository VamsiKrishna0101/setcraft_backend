import prisma from "../../config/prisma";
import { DayOfWeek, Difficulty, TrainingLocation, Prisma } from "@prisma/client";
import { ExerciseInput, AddWorkoutItemInput, UpdateWorkoutItemInput } from "./workout_types";
import redis from "../../config/redis";
import { localizedExercise } from '../../utils/fitness_locale';
import { realPlanWhere } from '../../utils/real_data';
import { invalidateProgress, progressRevision } from '../progress/progress_cache';
import { exerciseMediaGender, preferredExerciseMedia } from '../../utils/exercise_media';
import { invalidateExercisePageCache } from '../../utils/exercise_catalog_cache';
import { prescribedWorkoutMinutes } from '../../utils/workout_duration';

const EXERCISE_CACHE_TTL = 3600;

export const catalogExerciseSelect = {
    id: true,
    exerciseCode: true,
    name: true,
    namesByLang: true,
    description: true,
    category: true,
    duration: true,
    bodyPart: true,
    target: true,
    secondaryMuscles: true,
    equipment: true,
    instructions: true,
    difficulty: true,
    trainingLocation: true,
    videoUrl: true,
    mediaVariants: true,
    coachingMetadata: true,
    catalogStatus: true,
    thumbnailUrl: true,
    muscleGroup: true,
    mediaId: true,
    attribution: true,
    caloriesBurnEstimate: true,
    tempo: true,
    restSeconds: true,
    tips: true,
    createdAt: true,
    updatedAt: true,
};

export const exerciseSelect = {
    ...catalogExerciseSelect,
    instructionsByLang: true,
    instructionStepsByLang: true,
};

export function resolveMediaUrl(pathOrUrl?: string | null): string | null {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
        return pathOrUrl;
    }
    const base = process.env.EXERCISE_VIDEO_BASE_URL?.replace(/\/+$/, "") || "";
    const cleanPath = pathOrUrl.replace(/^\/+/, "");
    return base ? `${base}/${cleanPath}` : `/${cleanPath}`;
}

export function formatExercise<T extends { videoUrl?: string | null; thumbnailUrl?: string | null; mediaVariants?: unknown; coachingMetadata?: unknown }>(exercise: T, mediaGender?: 'male' | 'female'): T & { url: string | null; thumbnailUrl: string | null; exerciseType: string | null;mediaAspectRatio:number|null } {
    if (!exercise) return exercise as any;
    const variant = preferredExerciseMedia(exercise.mediaVariants, mediaGender ?? exerciseMediaGender());
    // A missing demo never borrows video or a poster from another body style.
    const resolvedVideo = variant?.url ?? null;
    const resolvedThumb = variant?.posterUrl ?? null;
    return {
        ...exercise,
        videoUrl: resolvedVideo,
        url: resolvedVideo, // Ensures Flutter WorkoutExerciseModel.url is fully populated!
        thumbnailUrl: resolvedThumb,
        exerciseType: (exercise.coachingMetadata as {exerciseType?:string}|null)?.exerciseType ?? null,
        mediaAspectRatio: variant?.aspectRatio ?? null,
    };
}

export function formatUserWorkout(uw: any) {
    if (!uw) return uw;
    return {
        ...uw,
        estimatedMinutes: prescribedWorkoutMinutes(Array.isArray(uw.items) ? uw.items : [],
            typeof uw.warmup?.durationMinutes === 'number' ? uw.warmup.durationMinutes : 0),
        items: Array.isArray(uw.items)
            ? uw.items.map((it: any) => ({
                ...it,
                workout: it.workout ? formatExercise(it.workout) : it.workout,
            }))
            : [],
    };
}

async function invalidateExerciseCaches(id?: string) {
    try { await invalidateExercisePageCache(); } catch { /* Short TTL bounds stale data during a cache outage. */ }
    try {
        const keys = await redis.keys("exercises:*");
        if (keys.length) await redis.del(...keys);
        if (id) {
            const detailKeys = await redis.keys(`exercise:*:${id}`);
            if (detailKeys.length) await redis.del(...detailKeys);
            await redis.del(`exercise:${id}`);
        }
    } catch (e) {
        console.warn("Failed to invalidate exercise Redis caches:", e);
    }
}

// Shared invalidation for schedule and session edits.
export async function invalidateUserWorkoutCache(userId: string) {
    try {
        // One Redis round trip. Old workout/history entries expire naturally.
        await redis.multi()
            .set(`progress-revision:${userId}`, `${Date.now()}-${Math.random()}`, { ex: 86400 })
            .del(`home:${userId}`)
            .exec();
    } catch (e) {
        console.warn("Failed to invalidate user workout Redis cache:", e);
    }
}

// ── Create exercise (admin) ───────────────────────────────────────────────────

export async function createExercise(input: ExerciseInput) {
    const existing = await prisma.workout.findUnique({ where: { name: input.name }, select: { id: true } });
    if (existing) throw new Error(`Exercise "${input.name}" already exists`);

    const exercise = await prisma.workout.create({
        data: {
            name: input.name, description: input.description,
            category: input.category, duration: input.duration,
            bodyPart: input.bodyPart, target: input.target ?? null,
            secondaryMuscles: input.secondaryMuscles ?? [], equipment: input.equipment,
            instructions: input.instructions, difficulty: input.difficulty,
            videoUrl: input.videoUrl ?? null, trainingLocation: input.trainingLocation,
        },
        select: exerciseSelect,
    });

    await invalidateExerciseCaches();
    return formatExercise(exercise);
}

// ── Get all exercises with optional filters ───────────────────────────────────

export interface GetAllExercisesFilter {
    category?: string;
    bodyPart?: string;
    difficulty?: string;
    trainingLocation?: string;
    equipment?: string;
    target?: string;
    search?: string;
}

export async function getAllExercises(filters: GetAllExercisesFilter = {}, locale = 'en') {
    const cacheKey = `exercises:v7:${exerciseMediaGender()}:${locale}:${JSON.stringify(filters)}`;
    try {
        const cached = await redis.get<any[]>(cacheKey);
        if (cached) return cached;
    } catch (e) {
        console.warn("Redis get error for exercises cache:", e);
    }

    const where: any = {catalogStatus:{notIn:['STAGED','ARCHIVED']}};
    if (filters.category) where.category = filters.category;
    if (filters.bodyPart?.trim()) where.bodyPart = { equals: filters.bodyPart.trim(), mode: 'insensitive' };
    if (filters.difficulty) where.difficulty = filters.difficulty as Difficulty;
    if (filters.trainingLocation) where.trainingLocation = filters.trainingLocation as TrainingLocation;
    if (filters.equipment?.trim()) where.equipment = { equals: filters.equipment.trim(), mode: 'insensitive' };
    if (filters.target) where.target = filters.target;
    if (filters.search && locale === 'en') {
        where.OR = [
            { name: { contains: filters.search, mode: "insensitive" } },
            { target: { contains: filters.search, mode: "insensitive" } },
            { bodyPart: { contains: filters.search, mode: "insensitive" } },
            { muscleGroup: { contains: filters.search, mode: "insensitive" } },
        ];
    }

    const exercises = await prisma.workout.findMany({
        where, select: { ...catalogExerciseSelect, description:false, instructions:false }, orderBy: { name: "asc" },
    });

    let formatted = exercises.filter(exercise => preferredExerciseMedia(exercise.mediaVariants))
        .map(exercise => localizedExercise(formatExercise(exercise), locale));
    if (filters.search && locale !== 'en') {
        const search = filters.search.toLocaleLowerCase();
        formatted = formatted.filter(e => [e.name, e.canonicalName, e.targetLabel, e.bodyPartLabel, e.equipmentLabel]
            .some(value => value.toLocaleLowerCase().includes(search)));
    }
    formatted.sort((a,b) => a.name.localeCompare(b.name, locale));
    try {
        await redis.set(cacheKey, formatted, { ex: EXERCISE_CACHE_TTL });
    } catch (e) {
        console.warn("Failed to set Redis cache for exercises:", e);
    }
    return formatted;
}

// ── Get single exercise by id ─────────────────────────────────────────────────

export async function getExerciseById(id: string, locale = 'en', mediaGender?: 'male' | 'female') {
    const cacheKey = `exercise:v6:${mediaGender ? 'strict-' + mediaGender : exerciseMediaGender()}:${locale}:${id}`;
    try {
        const cached = await redis.get<any>(cacheKey);
        if (cached) return cached;
    } catch (e) {
        console.warn("Redis get error for exercise detail cache:", e);
    }

    const exercise = await prisma.workout.findUnique({ where: { id }, select: exerciseSelect });
    if (!exercise) throw new Error("Exercise not found");

    const formatted = localizedExercise(formatExercise(exercise, mediaGender), locale);
    try {
        await redis.set(cacheKey, formatted, { ex: EXERCISE_CACHE_TTL });
    } catch (e) {
        console.warn("Failed to set Redis cache for exercise detail:", e);
    }
    return formatted;
}

// ── Update exercise (admin) ───────────────────────────────────────────────────

export async function updateExercise(id: string, input: Partial<ExerciseInput>) {
    const exercise = await prisma.workout.update({ where: { id }, data: input, select: exerciseSelect });
    await invalidateExerciseCaches(id);
    return exercise;
}

// ── Delete exercise (admin) ───────────────────────────────────────────────────

export async function deleteExercise(id: string) {
    await prisma.workout.delete({ where: { id } });
    await invalidateExerciseCaches(id);
    return { message: "Exercise deleted" };
}

// ── Get user's workouts for a specific day ────────────────────────────────────
// "day"       → DayOfWeek enum e.g. "MONDAY"
// "weekLabel" → (Optional) the label AI used when generating the plan e.g. "2026-W39"
//               frontend derives this the same way the AI plan generator does.
// Using weekLabel pins the query to THIS week's plan specifically,
// so we never accidentally serve a COMPLETED plan from a previous week.

export async function getUserWorkouts(userId: string, day: DayOfWeek, weekLabel?: string) {
    const revision = await progressRevision(userId);
    const cacheKey = weekLabel
        ? `userworkout:${userId}:${weekLabel}:${day}:real-v3:${revision}`
        : `userworkout:${userId}:${day}:real-v3:${revision}`;
    const cached = await redis.get<any>(cacheKey).catch(() => null);
    if (cached) return formatUserWorkout(cached);

    const where: any = {
        userId,
        status: { not: "SKIPPED" },
        session: null,
        scheduledDate: null,
        AND: [realPlanWhere],
    };
    if (weekLabel) {
        where.weekLabel = weekLabel;
    }

    let userWorkout = await prisma.userWorkout.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select: {
            id: true, weekLabel: true, status: true, aiNote: true, warmup: true,
            items: {
                where: { dayOfWeek: day, sourceProvider: 'USER' },
                orderBy: { orderIndex: "asc" },
                select: {
                    id: true, dayOfWeek: true, orderIndex: true,
                    targetSets: true, targetReps: true, targetWeight: true, setTargets: true, targetRpe: true,
                    restSeconds: true, status: true, completedAt: true,
                    workout: { select: exerciseSelect },
                },
            },
        },
    });

    const formattedWorkout = formatUserWorkout(userWorkout);
    if (formattedWorkout) {
        await redis.set(cacheKey, formattedWorkout, { ex: EXERCISE_CACHE_TTL });
    }
    return formattedWorkout;
}

export async function markItemComplete(userId: string, itemId: string) {
    const item = await prisma.userWorkoutItem.findFirst({
        where: { id: itemId, userWorkout: { userId, OR: [{ session: null }, { session: { status: { not: "COMPLETED" } } }] } },
    });

    if (!item) throw new Error("Exercise not found");

    const updated = await prisma.userWorkoutItem.update({
        where: { id: itemId },
        data: { status: "COMPLETED", completedAt: new Date() },
    });

    await invalidateUserWorkoutCache(userId);
    await redis.del(`home:${userId}`);
    return updated;
}

export async function markItemSkip(userId: string, itemId: string) {
    const item = await prisma.userWorkoutItem.findFirst({
        where: { id: itemId, userWorkout: { userId, OR: [{ session: null }, { session: { status: { not: "COMPLETED" } } }] } },
    });

    if (!item) throw new Error("Exercise not found");

    const updated = await prisma.userWorkoutItem.update({
        where: { id: itemId },
        data: { status: "SKIPPED", completedAt: null },
    });

    await invalidateUserWorkoutCache(userId);
    await redis.del(`home:${userId}`);
    return updated;
}

export async function updateWorkoutItem(userId: string, itemId: string, input: UpdateWorkoutItemInput) {
    const item = await prisma.userWorkoutItem.findFirst({
        where: { id: itemId, userWorkout: { userId, OR: [{ session: null }, { session: { status: { not: "COMPLETED" } } }] } },
    });

    if (!item) throw new Error("Exercise not found");

    const updated = await prisma.userWorkoutItem.update({
        where: { id: itemId },
        data: { ...input,
            ...(input.targetSets !== undefined || input.targetReps !== undefined || input.targetWeight !== undefined
                ? { setTargets: Prisma.DbNull } : {}),
            ...(input.status === "NOT_STARTED" ? { completedAt: null } : {}) },
        select: {
            id: true, dayOfWeek: true, orderIndex: true,
            targetSets: true, targetReps: true, targetWeight: true, setTargets: true, targetRpe: true,
            restSeconds: true, status: true, completedAt: true,
            workout: { select: exerciseSelect },
        },
    });

    await invalidateUserWorkoutCache(userId);
    await redis.del(`home:${userId}`);
    return updated;
}

export async function addWorkoutItem(userId: string, input: AddWorkoutItemInput) {
    const candidate = input.workoutId
        ? await prisma.workout.findUnique({where:{id:input.workoutId},select:{coachingMetadata:true,catalogStatus:true}})
        : input.customExercise
            ? await prisma.workout.findUnique({where:{name:input.customExercise.name},select:{coachingMetadata:true,catalogStatus:true}})
            : null;
    if (input.workoutId && !candidate) throw new Error('Exercise not found.');
    if (candidate?.catalogStatus==='STAGED') throw new Error('This exercise is awaiting review.');
    const modality = (candidate?.coachingMetadata as {exerciseType?:string}|null)?.exerciseType;
    if (modality && !['weight_reps','bodyweight_reps'].includes(modality)) {
        throw new Error('This exercise uses time, distance, or assistance rather than standard load-and-repetition logging.');
    }
    let userWorkoutId = input.userWorkoutId;
    if (userWorkoutId) {
        // Once today's workout is started, the app's plan id is the session snapshot; add there.
        const plan = await prisma.userWorkout.findFirst({ where: { id: userWorkoutId, userId }, select: { session: { select: { status: true } } } });
        if (!plan) throw new Error("Workout not found");
        if (plan.session?.status === "COMPLETED") throw new Error("This workout is already finished.");
    }
    if (!userWorkoutId) {
        const existing = await prisma.userWorkout.findFirst({
            where: { userId, session: null, status: { notIn: ["COMPLETED", "SKIPPED"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (existing) {
            userWorkoutId = existing.id;
        } else {
            const created = await prisma.userWorkout.create({
                data: {
                    userId,
                    weekLabel: "Custom Plan",
                    status: "IN_PROGRESS",
                },
                select: { id: true },
            });
            userWorkoutId = created.id;
        }
    }

    let workoutId = input.workoutId;
    if (!workoutId && input.customExercise) {
        const custom = input.customExercise;
        const existing = await prisma.workout.findUnique({
            where: { name: custom.name },
            select: { id: true },
        });
        if (existing) {
            workoutId = existing.id;
        } else {
            const createdWorkout = await prisma.workout.create({
                data: {
                    name: custom.name,
                    description: custom.description ?? "Custom user exercise",
                    category: custom.category ?? "Strength",
                    duration: 10,
                    bodyPart: custom.bodyPart,
                    target: custom.target ?? custom.bodyPart,
                    secondaryMuscles: custom.secondaryMuscles ?? [],
                    equipment: custom.equipment ?? "Bodyweight",
                    instructions: custom.instructions.length > 0 ? custom.instructions : ["Perform with controlled tempo."],
                    difficulty: custom.difficulty ?? Difficulty.BEGINNER,
                    videoUrl: custom.videoUrl,
                    trainingLocation: custom.trainingLocation ?? TrainingLocation.GYM,
                },
                select: { id: true },
            });
            workoutId = createdWorkout.id;
        }
    }

    if (!workoutId) throw new Error("Either workoutId or customExercise must be provided");

    const lastItem = await prisma.userWorkoutItem.findFirst({
        where: { userWorkoutId, dayOfWeek: input.dayOfWeek },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
    });
    const nextIndex = (lastItem?.orderIndex ?? -1) + 1;

    const newItem = await prisma.userWorkoutItem.create({
        data: {
            userWorkoutId,
            workoutId,
            dayOfWeek: input.dayOfWeek,
            orderIndex: nextIndex,
            targetSets: input.targetSets,
            targetReps: input.targetReps,
            targetWeight: input.targetWeight ?? 0,
            targetRpe: input.targetRpe ?? 8.0,
            restSeconds: input.restSeconds,
            status: "NOT_STARTED",
        },
        select: {
            id: true, dayOfWeek: true, orderIndex: true,
            targetSets: true, targetReps: true, targetWeight: true, setTargets: true, targetRpe: true,
            restSeconds: true, status: true, completedAt: true,
            workout: { select: exerciseSelect },
        },
    });

    await invalidateUserWorkoutCache(userId);
    await redis.del(`home:${userId}`);
    return {
        ...newItem,
        workout: newItem.workout ? formatExercise(newItem.workout) : newItem.workout,
    };
}

export async function deleteWorkoutItem(userId: string, itemId: string) {
    const item = await prisma.userWorkoutItem.findFirst({
        where: { id: itemId, userWorkout: { userId, OR: [{ session: null }, { session: { status: { not: "COMPLETED" } } }] } },
    });

    if (!item) throw new Error("Exercise not found");

    if (await prisma.workoutSetLog.count({ where: { userWorkoutItemId: itemId } })) {
        throw new Error("Keep exercises with logged sets. Skip them instead.");
    }
    await prisma.userWorkoutItem.delete({ where: { id: itemId } });
    await invalidateUserWorkoutCache(userId);
    await redis.del(`home:${userId}`);
    return { message: "Exercise removed from today's plan" };
}

export async function markWorkoutComplete(userId: string, workoutId: string) {
    const session = await prisma.workoutSession.findFirst({ where: { userId, userWorkoutId: workoutId } });
    if (!session) throw new Error("Start a dated workout before finishing it.");
    const { finishSession } = await import('./session/session_service');
    await finishSession(userId, session.date);
    return prisma.userWorkout.findUnique({ where: { id: workoutId } });
}

export async function logSet(userId: string, input: {
    userWorkoutItemId: string;
    setNumber: number;
    reps: number;
    weight?: number;
    rpe?: number;
    day: string;
    month: string;
    year: string;
}) {
    const item = await prisma.userWorkoutItem.findFirst({
        where: { id: input.userWorkoutItemId, sourceProvider: "USER", userWorkout: { userId, session: null } },
    });

    if (!item) throw new Error("Exercise not found");

    const clientKey = `${userId}:${input.userWorkoutItemId}:${input.year}-${input.month.padStart(2, '0')}-${input.day.padStart(2, '0')}:${input.setNumber}`;
    const setLog = await prisma.workoutSetLog.upsert({
        where: { clientKey },
        update: { reps: input.reps, weight: input.weight ?? null, rpe: input.rpe ?? null },
        create: {
            clientKey,
            userId,
            userWorkoutItemId: input.userWorkoutItemId,
            setNumber: input.setNumber,
            reps: input.reps,
            weight: input.weight ?? null,
            rpe: input.rpe ?? null,
            day: input.day,
            month: input.month,
            year: input.year,
        },
    });

    await invalidateUserWorkoutCache(userId);
    return setLog;
}

export async function getPreviousSets(userId: string, workoutItemIds: string[]) {
    const logs = await prisma.workoutSetLog.findMany({
        where: {
            userId,
            userWorkoutItemId: { in: workoutItemIds },
        },
        orderBy: { createdAt: "desc" },
        select: {
            userWorkoutItemId: true,
            setNumber: true,
            weight: true,
            reps: true,
            rpe: true,
            day: true,
            month: true,
            year: true,
        },
    });

    const grouped: Record<string, typeof logs> = {};
    for (const log of logs) {
        if (!grouped[log.userWorkoutItemId]) {
            grouped[log.userWorkoutItemId] = [];
        }
        grouped[log.userWorkoutItemId].push(log);
    }

    return grouped;
}
