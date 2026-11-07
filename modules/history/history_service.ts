import {
    StrengthHistoryQuery,
    NutritionHistoryQuery,
    RecoveryHistoryQuery,
    BodyHistoryQuery,
    WorkoutCompletionQuery,
    VolumeHistoryQuery,
} from "./history_types";
import prisma from "../../config/prisma";
import { progressRevision } from '../progress/progress_cache';
import redis from "../../config/redis";
import { realMealWhere, realSnapshotWhere } from "../../utils/real_data";

const HISTORY_CACHE_TTL = 3600;

function getWeekBuckets(weeks: number) {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToMonday = (currentDay + 6) % 7;
    const currentWeekMonday = new Date(now);
    currentWeekMonday.setDate(now.getDate() - diffToMonday);
    currentWeekMonday.setHours(0, 0, 0, 0);

    const buckets: { week: string; start: Date; end: Date }[] = [];

    for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(currentWeekMonday);
        start.setDate(currentWeekMonday.getDate() - i * 7);

        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        const startMonth = start.toLocaleString("en-US", { month: "short" });
        const endMonth = end.toLocaleString("en-US", { month: "short" });
        const startDay = start.getDate();
        const endDay = end.getDate();

        const week = startMonth === endMonth
            ? `${startMonth} ${startDay}–${endDay}`
            : `${startMonth} ${startDay}–${endMonth} ${endDay}`;

        buckets.push({ week, start, end });
    }

    return buckets;
}

export async function getStrengthHistory(userId: string, input: StrengthHistoryQuery) {
    const revision = await progressRevision(userId);
    const cacheKey = `history:strength:${userId}:${input.workoutId}:${input.days}:real-v2:${revision}`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) return cached;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - input.days);

    const logs = await prisma.workoutSetLog.findMany({
        where: {
            userId,
            workoutItem: { workoutId: input.workoutId, sourceProvider: "USER", userWorkout: { userId } },
            createdAt: { gte: cutoffDate },
        },
        select: {
            weight: true,
            reps: true,
            rpe: true,
            day: true,
            month: true,
            year: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });

    const grouped: Record<string, { maxWeight: number; totalReps: number; rpeSum: number; rpeCount: number }> = {};

    for (const log of logs) {
        const date = `${log.year}-${log.month.padStart(2, "0")}-${log.day.padStart(2, "0")}`;
        if (!grouped[date]) {
            grouped[date] = { maxWeight: 0, totalReps: 0, rpeSum: 0, rpeCount: 0 };
        }
        const g = grouped[date];
        if ((log.weight ?? 0) > g.maxWeight) g.maxWeight = log.weight ?? 0;
        g.totalReps += log.reps;
        if (log.rpe != null) {
            g.rpeSum += log.rpe;
            g.rpeCount += 1;
        }
    }

    const result = Object.entries(grouped).map(([date, g]) => ({
        date,
        maxWeight: g.maxWeight,
        totalReps: g.totalReps,
        avgRpe: g.rpeCount > 0 ? Math.round((g.rpeSum / g.rpeCount) * 10) / 10 : null,
    }));

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL });
    return result;
}

export async function getNutritionHistory(userId: string, input: NutritionHistoryQuery) {
    const revision = await progressRevision(userId);
    const cacheKey = `history:nutrition:${userId}:${input.days}:real-v2:${revision}`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) return cached;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - input.days);

    const logs = await prisma.userMealLog.findMany({
        where: {
            ...realMealWhere,
            userId,
            createdAt: { gte: cutoffDate },
        },
        select: {
            calories: true,
            protein: true,
            carbs: true,
            fat: true,
            day: true,
            month: true,
            year: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });

    const grouped: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {};

    for (const log of logs) {
        const date = `${log.year}-${log.month.padStart(2, "0")}-${log.day.padStart(2, "0")}`;
        if (!grouped[date]) {
            grouped[date] = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        }
        const g = grouped[date];
        g.calories += log.calories;
        g.protein += log.protein;
        g.carbs += log.carbs;
        g.fat += log.fat;
    }

    const result = Object.entries(grouped).map(([date, g]) => ({
        date,
        calories: Math.round(g.calories),
        protein: Math.round(g.protein * 10) / 10,
        carbs: Math.round(g.carbs * 10) / 10,
        fat: Math.round(g.fat * 10) / 10,
    }));

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL });
    return result;
}

export async function getRecoveryHistory(userId: string, input: RecoveryHistoryQuery) {
    const endDate = input.date ?? new Date().toISOString().slice(0, 10);
    const cacheKey = `history:recovery:${userId}:${input.days}:${endDate}:real-v3`;
    const cached = await redis.get<any>(cacheKey).catch(() => null);
    if (cached) return cached;

    const cutoff = new Date(`${endDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - input.days + 1);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const rows = await prisma.healthKitSnapshot.findMany({
        where: {
            ...realSnapshotWhere,
            userId,
            date: { gte: cutoffDate, lte: endDate },
        },
        select: {
            date: true,
            hrv: true,
            hrvMethod: true,
            sourceProvider: true,
            restingHR: true,
            recoveryScore: true,
            sleepTotalMinutes: true,
            sleepEfficiency: true,
        },
        orderBy: { date: "asc" },
    });

    const result = rows
        .filter((r) => r.hrv != null || r.restingHR != null || r.sleepTotalMinutes != null || r.sleepEfficiency != null)
        .map((r) => ({
            date: r.date,
            hrv: r.hrv != null ? Math.round(r.hrv * 10) / 10 : null,
            hrvMethod: r.hrvMethod ?? (r.sourceProvider === 'GOOGLE_HEALTH_CONNECT' ? 'RMSSD' : r.sourceProvider === 'APPLE_HEALTHKIT' ? 'SDNN' : null),
            restingHR: r.restingHR != null ? Math.round(r.restingHR) : null,
            recoveryScore: r.recoveryScore != null && (r.sleepTotalMinutes ?? 0) > 0 && (r.hrv != null || r.restingHR != null)
                ? Math.round(r.recoveryScore) : null,
            sleepHours: r.sleepTotalMinutes != null ? Math.round((r.sleepTotalMinutes / 60) * 10) / 10 : null,
            source: 'device',
        }));

    const manual = await prisma.dailyWellnessEntry.findMany({ where: { userId, date: { gte: cutoffDate, lte: endDate } } });
    for (const log of manual) {
        const device = result.find(row => row.date === log.date);
        if (device) {
            if (device.sleepHours == null) device.sleepHours = Math.round(log.sleepMinutes / 6) / 10;
        } else {
            result.push({ date: log.date, hrv: null, hrvMethod: null, restingHR: null, recoveryScore: null,
                sleepHours: Math.round(log.sleepMinutes / 6) / 10, source: log.source });
        }
    }
    result.sort((a, b) => a.date.localeCompare(b.date));

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL }).catch(() => undefined);
    return result;
}

export async function getBodyHistory(userId: string, input: BodyHistoryQuery) {
    const cacheKey = `history:body:${userId}:${input.days}:real-v1`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) return cached;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - input.days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const rows = await prisma.healthKitSnapshot.findMany({
        where: {
            userId,
            date: { gte: cutoffDate },
            weight: { not: null },
            ...realSnapshotWhere,
        },
        select: {
            date: true,
            weight: true,
            bodyFatPct: true,
            leanMassKg: true,
        },
        orderBy: { date: "asc" },
    });

    const result = rows.map((r) => ({
        date: r.date,
        weight: r.weight != null ? Math.round(r.weight * 10) / 10 : null,
        bodyFatPct: r.bodyFatPct != null ? Math.round(r.bodyFatPct * 10) / 10 : null,
        leanMassKg: r.leanMassKg != null ? Math.round(r.leanMassKg * 10) / 10 : null,
    }));

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL });
    return result;
}

export async function getWorkoutCompletion(userId: string, input: WorkoutCompletionQuery) {
    const revision = await progressRevision(userId);
    const cacheKey = `history:completion:${userId}:${input.weeks}:real-v2:${revision}`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) return cached;

    const buckets = getWeekBuckets(input.weeks);
    const oldestStart = buckets[0].start;

    const items = await prisma.userWorkoutItem.findMany({
        where: {
            sourceProvider: "USER",
            userWorkout: { userId },
            OR: [
                { createdAt: { gte: oldestStart } },
                { completedAt: { gte: oldestStart } },
            ],
        },
        select: {
            status: true,
            createdAt: true,
            completedAt: true,
        },
    });

    const result = buckets.map((b) => {
        const planned = items.filter(
            (item) => item.createdAt >= b.start && item.createdAt <= b.end
        ).length;

        const completed = items.filter(
            (item) =>
                item.status === "COMPLETED" &&
                ((item.completedAt && item.completedAt >= b.start && item.completedAt <= b.end) ||
                 (!item.completedAt && item.createdAt >= b.start && item.createdAt <= b.end))
        ).length;

        const rate = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;

        return {
            week: b.week,
            planned,
            completed,
            rate,
        };
    });

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL });
    return result;
}

export async function getVolumeHistory(userId: string, input: VolumeHistoryQuery) {
    const revision = await progressRevision(userId);
    const cacheKey = `history:volume:${userId}:${input.weeks}:v2:${revision}`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) return cached;

    const buckets = getWeekBuckets(input.weeks);
    const oldestStart = buckets[0].start;

    const logs = await prisma.workoutSetLog.findMany({
        where: {
            userId,
            workoutItem: { sourceProvider: "USER", userWorkout: { userId } },
            createdAt: { gte: oldestStart },
        },
        select: {
            weight: true,
            reps: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });

    const result = buckets.map((b) => {
        const weekLogs = logs.filter(
            (l) => l.createdAt >= b.start && l.createdAt <= b.end
        );

        const totalVolume = weekLogs.reduce(
            (sum, l) => sum + (l.weight ?? 0) * l.reps,
            0
        );

        return {
            week: b.week,
            totalVolume: Math.round(totalVolume),
            totalSets: weekLogs.length,
        };
    });

    await redis.set(cacheKey, result, { ex: HISTORY_CACHE_TTL });
    return result;
}
