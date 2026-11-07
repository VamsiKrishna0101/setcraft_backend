import { ReadinessInput, UserReadinessInput } from "./readiness_types";
import redis from "../../config/redis";
import prisma from "../../config/prisma";

const READINESS_CACHE_TTL = 3600;

export async function logReadiness(input: ReadinessInput, userId: string) {
    const existing = await prisma.readiness.findUnique({
        where: {
            userId_day_month_year: {
                userId,
                day: input.day,
                month: input.month,
                year: input.year,
            },
        },
    });

    if (existing) {
        throw new Error("Readiness score already logged for this date");
    }

    const score = await prisma.readiness.create({
        data: {
            userId,
            sleep: input.sleep,
            recovery: input.recovery,
            aiTarget: input.aiTarget,
            day: input.day,
            month: input.month,
            year: input.year,
        },
    });

    const cacheKey = `readiness:${userId}:${input.day}:${input.month}:${input.year}`;
    await redis.set(cacheKey, score, { ex: READINESS_CACHE_TTL });
    await redis.del(`home:${userId}`);

    return score;
}

export async function getUserReadiness(input: UserReadinessInput, userId: string) {
    const cacheKey = `readiness:${userId}:${input.day}:${input.month}:${input.year}`;
    const cached = await redis.get<any>(cacheKey);
    if (cached) {
        return cached;
    }

    const score = await prisma.readiness.findUnique({
        where: {
            userId_day_month_year: {
                userId,
                day: input.day,
                month: input.month,
                year: input.year,
            },
        },
    });

    if (score) {
        await redis.set(cacheKey, score, { ex: READINESS_CACHE_TTL });
    }

    return score;
}

// Aliases for compatibility
export const LogRediness = logReadiness;
export const GetUserReadiness = getUserReadiness;
