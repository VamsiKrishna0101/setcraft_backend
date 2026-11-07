import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { HealthkitInput } from "./healthkit_types";
import { isPreviewSource } from "../../utils/real_data";
import { invalidateProgress } from '../progress/progress_cache';
import { Prisma } from '@prisma/client';

const HEALTHKIT_CACHE_TTL = 3600;

export function computeRecoveryScore(data: {
    hrv?: number | null;
    restingHR?: number | null;
    sleepEfficiency?: number | null;
    sleepTotalMinutes?: number | null;
}): number | null {
    // Movement alone, or a single biometric, cannot establish readiness.
    const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const hasSleep = positive(data.sleepTotalMinutes);
    const hasHeart = positive(data.hrv) || positive(data.restingHR);
    if (!hasSleep || !hasHeart) return null;
    let score = 0;
    let totalWeight = 0;

    const clamp = (val: number, min: number, max: number) =>
        Math.min(Math.max(val, min), max);

    if (positive(data.hrv)) {
        const s = clamp(((data.hrv - 20) / 60) * 100, 0, 100);
        score += s * 40;
        totalWeight += 40;
    }

    if (positive(data.restingHR)) {
        const s = clamp(((80 - data.restingHR) / 30) * 100, 0, 100);
        score += s * 30;
        totalWeight += 30;
    }

    if (data.sleepEfficiency != null) {
        const s = clamp((data.sleepEfficiency / 85) * 100, 0, 100);
        score += s * 20;
        totalWeight += 20;
    }

    if (data.sleepTotalMinutes != null) {
        const hours = data.sleepTotalMinutes / 60;
        const s = hours >= 7 && hours <= 9 ? 100
            : hours >= 6 ? 70
            : hours >= 5 ? 40
            : 20;
        score += s * 10;
        totalWeight += 10;
    }

    return totalWeight > 0 ? Math.round(score / totalWeight) : null;
}

function recoveryScoreToNote(score: number): string {
    if (score >= 65) return "Setcraft readiness estimate from recorded sleep and heart data. Check how you feel before training.";
    return "Setcraft readiness estimate is lower today. Review your recorded sleep and how you feel.";
}

export async function syncHealthKit(userId: string, input: HealthkitInput) {
    const { externalWorkouts, metricMetadata, ...snapshotFields } = input;

    const persist = () => prisma.$transaction(async tx => {
        const existing = await tx.healthKitSnapshot.findUnique({ where: { userId_date: { userId, date: input.date } } });
        const changedSource = existing && (isPreviewSource(existing.sourceProvider) ||
            (input.sourceProvider && existing.sourceProvider !== input.sourceProvider));
        const reset = changedSource ? Object.fromEntries([
            'sleepTotalMinutes', 'sleepDeepMinutes', 'sleepRemMinutes', 'sleepCoreMinutes', 'sleepEfficiency',
            'hrv', 'hrvMethod', 'restingHR', 'avgDayHR', 'activeCalories', 'basalCalories', 'steps',
            'flightsClimbed', 'weight', 'bodyFatPct', 'leanMassKg', 'vo2Max', 'bloodOxygen',
            'respiratoryRate', 'wristTempDeviation', 'bloodGlucoseAvg', 'cardioRecoveryHr', 'cyclePhase', 'healthAge',
        ].map(key => [key, null])) : {};
        const metadata = { ...(!changedSource && existing?.metricMetadata && typeof existing.metricMetadata === 'object'
            ? existing.metricMetadata as Record<string, unknown> : {}), ...metricMetadata };
        const snapshot = await tx.healthKitSnapshot.upsert({
            where: { userId_date: { userId, date: input.date } },
            create: { userId, ...snapshotFields, metricMetadata: metadata as Prisma.InputJsonValue },
            update: { ...reset, ...snapshotFields, metricMetadata: metadata as Prisma.InputJsonValue, syncedAt: new Date() },
        });
        const recoveryScore = computeRecoveryScore(snapshot);
        const aiNote = recoveryScore == null ? null : recoveryScoreToNote(recoveryScore);
        const updated = await tx.healthKitSnapshot.update({ where: { id: snapshot.id }, data: { recoveryScore, aiNote } });
        for (const workout of externalWorkouts ?? []) {
            const externalId = `${userId}:${workout.externalId}`;
            // Upgrade this account's old timestamp IDs in place, preserving records.
            const legacy = await tx.healthKitWorkout.findFirst({ where: {
                userId, startedAt: workout.startedAt, workoutType: workout.workoutType, source: workout.source,
                NOT: { externalId: { startsWith: `${userId}:` } },
            } });
            if (legacy) {
                await tx.healthKitWorkout.update({ where: { id: legacy.id }, data: { ...workout, externalId } });
            } else {
                await tx.healthKitWorkout.upsert({ where: { externalId },
                    create: { userId, ...workout, externalId }, update: { ...workout, externalId } });
            }
        }
        return { snapshot: updated, recoveryScore, aiNote };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let result: Awaited<ReturnType<typeof persist>>;
    for (let attempt = 0; ; attempt++) {
        try { result = await persist(); break; }
        catch (error) {
            if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        }
    }

    await redis.del(`healthkit:${userId}:${input.date}`, `home:${userId}`).catch(() => undefined);
    await invalidateProgress(userId);
    const historyKeys = await redis.keys(`history:*:${userId}:*`).catch(() => []);
    if (historyKeys.length) await redis.del(...historyKeys).catch(() => undefined);

    return result;
}

export async function getSnapshot(userId: string, date?: string) {
    const resolvedDate = date ?? new Date().toISOString().slice(0, 10);
    const cacheKey = `healthkit:${userId}:${resolvedDate}`;

    const cached = await redis.get<any>(cacheKey).catch(() => null);
    if (cached && !isPreviewSource(cached.sourceProvider)) return cached;

    const snapshot = await prisma.healthKitSnapshot.findUnique({
        where: { userId_date: { userId, date: resolvedDate } },
    });

    if (snapshot && !isPreviewSource(snapshot.sourceProvider)) {
        await redis.set(cacheKey, snapshot, { ex: HEALTHKIT_CACHE_TTL }).catch(() => undefined);
    }

    return snapshot && !isPreviewSource(snapshot.sourceProvider) ? snapshot : null;
}

export async function getImportedWorkouts(userId: string, date: string) {
    const snapshot = await prisma.healthKitSnapshot.findUnique({ where: { userId_date: { userId, date } }, select: { utcOffsetMinutes: true } });
    const start = new Date(Date.parse(`${date}T00:00:00Z`) - (snapshot?.utcOffsetMinutes ?? 0) * 60_000);
    return prisma.healthKitWorkout.findMany({ where: { userId,
        startedAt: { gte: start, lt: new Date(start.getTime() + 86400_000) },
        source: { in: ['GOOGLE_HEALTH_CONNECT', 'APPLE_HEALTHKIT'] } },
        orderBy: { startedAt: 'desc' }, take: 50 });
}
