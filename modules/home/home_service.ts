import { nutritionTargets } from '../../utils/nutrition_targets';
import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { DayOfWeek, DailyWellnessEntry, HealthKitSnapshot, Readiness } from "@prisma/client";
import { getPlanForDate } from "../workout/session/session_service";
import { HomeData, HomeReadiness, HomeTodayWorkout, WeekDay } from "./home_types";
import { realMealWhere, realSnapshotWhere, realCoachingNote, realPlanWhere } from "../../utils/real_data";
import { computeCheckInEstimate } from '../wellness/checkin_estimate';

const HOME_CACHE_TTL = 30; // 30 seconds — ultra-short TTL for live, zero-stale home screen

const DAYS_OF_WEEK: DayOfWeek[] = [
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Map (sleep, recovery) strings to a 0–10 score
export function calcReadinessScore(sleep: string, recovery: string): number | null {
    const sleepScore: Record<string, number> = {
        LESS_THAN_6_HOURS: 2, HOURS_6_TO_7: 5, HOURS_7_TO_8: 8, HOURS_8_PLUS: 10,
    };
    const recoveryScore: Record<string, number> = {
        POOR: 2, FAIR: 5, GOOD: 8, OPTIMAL: 10,
    };
    const s = sleepScore[sleep];
    const r = recoveryScore[recovery];
    if (s == null || r == null) return null;
    return Math.round(((s + r) / 2) * 10) / 10;
}

function readinessLabel(score: number): string {
    if (score >= 8) return "Optimal Recovery";
    if (score >= 6) return "Good to Go";
    if (score >= 4) return "Moderate – Take it easy";
    return "Low – Consider rest";
}

type DailyHealth = Pick<HealthKitSnapshot, 'date' | 'sourceProvider' | 'aiNote' |
    'hrv' | 'hrvMethod' | 'restingHR' | 'sleepTotalMinutes' | 'sleepEfficiency' | 'steps' | 'activeCalories'>;
type SleepEntry = Pick<DailyWellnessEntry, 'date' | 'sleepMinutes' | 'energy' | 'rested' | 'soreness' | 'source'>;
type ManualReadiness = Pick<Readiness, 'day' | 'month' | 'year' | 'sleep' | 'recovery' | 'aiTarget'>;

/** Shared by Home and the save response, so a confirmed entry has one score. */
export function buildDailyReadiness(date: string, _wearableUsage: string,
    _health: DailyHealth | null, entry: SleepEntry | null,
    _manual: ManualReadiness | null = null): HomeReadiness | null {
    const sleep = entry?.date === date ? entry : null;
    const score = sleep ? computeCheckInEstimate(sleep) : null;
    // Optional wearable data never substitutes for today's reported answers.
    return score == null || !sleep ? null : {
        score: score / 10, source: 'check_in_estimate', date,
        label: 'Daily check-in estimate', sleepSource: sleep.source,
        aiTarget: 'Based on your reported sleep, rest, energy and soreness. This is a fitness estimate, not measured recovery.',
        sleepMinutes: sleep.sleepMinutes,
    };
}

// Calculate TDEE-based macro targets from onboarding data
export function calcTargets(onboarding: any) {
    if (onboarding.height == null || onboarding.weight == null)
        return { targetCalories: 0, targetProtein: 0, targetCarbs: 0, targetFat: 0 };
    return nutritionTargets(onboarding);
}

export async function getHomeData(userId: string, forceRefresh: boolean = false, date?: string): Promise<HomeData> {
    const cacheKey = `home:${userId}`;
    if (!forceRefresh) {
        const cached = await redis.get<HomeData>(cacheKey).catch(() => null);
        if (cached?.dataVersion === 15 && cached.calendarDate === (date ?? new Date().toISOString().slice(0, 10))) return cached;
    }

    const now = date ? new Date(`${date}T12:00:00`) : new Date();
    const day   = String(now.getDate());
    const month = String(now.getMonth() + 1);
    const year  = String(now.getFullYear());
    const jsDayIndex  = now.getDay();
    const prismaIndex = jsDayIndex === 0 ? 6 : jsDayIndex - 1;
    const todayEnum   = DAYS_OF_WEEK[prismaIndex];
    const currentMonday = new Date(now);
    const diffToMonday = now.getDay() === 0 ? -6 : 1 - now.getDay();
    currentMonday.setDate(now.getDate() + diffToMonday);
    currentMonday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(currentMonday);
    nextMonday.setDate(currentMonday.getDate() + 7);

    // ── Fetch in parallel ─────────────────────────────────────────────────────
    const sleepDate = date ?? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const [onboarding, readinessRow, userWorkoutRow, mealLogs, allWorkoutItems, hkSnapshot, waterAgg, userRecord, weekSessions, weekRestDays, manualSleep] = await Promise.all([
        prisma.onboarding.findUnique({ where: { userId } }),

        prisma.readiness.findFirst({
            where: { userId, day: { in: [day, day.padStart(2, '0')] }, month: { in: [month, month.padStart(2, '0')] }, year },
            orderBy: { updatedAt: "desc" },
        }),

        getPlanForDate(userId, `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`),

        prisma.userMealLog.findMany({
            where: { userId, day: { in: [day, day.padStart(2, '0')] }, month: { in: [month, month.padStart(2, '0')] }, year, status: 'LOGGED', ...realMealWhere },
            select: { calories: true, protein: true, carbs: true, fat: true },
        }),

        prisma.userWorkoutItem.findMany({
            where: {
                sourceProvider: "USER",
                userWorkout: {
                    userId,
                    AND: [realPlanWhere],
                    status: { notIn: ["SKIPPED"] },
                    createdAt: { gte: currentMonday, lt: nextMonday },
                },
            },
            select: {
                dayOfWeek: true,
                status: true,
                completedAt: true,
            },
            orderBy: { completedAt: "desc" },
        }),

        prisma.healthKitSnapshot.findFirst({
            where: { userId, date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, ...realSnapshotWhere },
            orderBy: { date: "desc" },
            select: {
                date: true,
                recoveryScore: true,
                aiNote: true,
                activeCalories: true,
                hrv: true,
                restingHR: true,
                sleepTotalMinutes: true,
                sleepEfficiency: true,
                steps: true,
                sourceProvider: true,
                hrvMethod: true,
                updatedAt: true,
            },
        }),

        prisma.userWaterLog.aggregate({
            where: { userId, day: { in: [day, day.padStart(2, '0')] }, month: { in: [month, month.padStart(2, '0')] }, year, sourceProvider: "USER" },
            _sum: { amountMl: true },
        }),

        prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, wearableUsage: true },
        }),
        prisma.workoutSession.findMany({ where: { userId,
            userWorkout: { items: { some: { sourceProvider: 'USER' } } },
            date: { gte: `${currentMonday.getFullYear()}-${String(currentMonday.getMonth() + 1).padStart(2, '0')}-${String(currentMonday.getDate()).padStart(2, '0')}`,
                lt: `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}` } },
            select: { date: true, status: true } }),
        prisma.workoutDay.findMany({ where: { userId, restDay: true }, select: { date: true } }),
        prisma.dailyWellnessEntry.findUnique({ where: { userId_date: { userId, date: sleepDate } } }),
    ]);

    // ── User & streak ─────────────────────────────────────────────────────────
    const userName = onboarding?.name?.trim() ?? "";
    const streakDays = await calcStreak(userId, now);

    // ── Readiness ─────────────────────────────────────────────────────────────
    const readiness = buildDailyReadiness(sleepDate, userRecord?.wearableUsage ?? 'UNKNOWN',
        hkSnapshot, manualSleep, readinessRow);

    // ── Today's workout ───────────────────────────────────────────────────────
    let todayWorkout: HomeTodayWorkout | null = null;
    if (userWorkoutRow) {
        const items = userWorkoutRow.items;
        const exerciseCount = items.length;
        const durationMinutes = userWorkoutRow.estimatedMinutes;
        const primaryWorkout = items[0]?.workout;
        const category = primaryWorkout?.category ?? "";
        const bodyParts = new Set(items.map(i => i.workout.bodyPart.toLowerCase()));
        const strength = category.toLowerCase() === "strength";
        const sessionTitle = strength && bodyParts.size > 1 ? "Full-body strength"
            : strength ? "Strength session" : category ? `${category.charAt(0).toUpperCase()}${category.slice(1)} session`
            : primaryWorkout?.name ?? "";
        todayWorkout = items.length > 0 ? {
            userWorkoutId: userWorkoutRow.id,
            weekLabel: userWorkoutRow.weekLabel,
            workoutTitle: primaryWorkout?.name ?? "",
            workoutTitleByLang: primaryWorkout?.namesByLang as Record<string,string> | undefined,
            sessionTitle,
            category: primaryWorkout?.category ?? "",
            exerciseCount,
            durationMinutes,
            status: userWorkoutRow.status === "REST_DAY" ? "REST_DAY"
                : userWorkoutRow.status === "COMPLETED" || items.every(i => i.status === "COMPLETED") ? "COMPLETED"
                : items.some(i => i.status === "IN_PROGRESS" || i.status === "COMPLETED") ? "IN_PROGRESS"
                : items.every(i => i.status === "REST_DAY") ? "REST_DAY" : "NOT_STARTED",
            aiNote: userWorkoutRow.aiNote ?? null,
        } : null;
    }

    // ── Nutrition ─────────────────────────────────────────────────────────────
    const consumed = mealLogs.reduce(
        (acc, log) => {
            acc.calories += log.calories;
            acc.protein  += log.protein;
            acc.carbs    += log.carbs;
            acc.fat      += log.fat;
            return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    let targets = onboarding
        ? calcTargets(onboarding)
        : { targetCalories: 0, targetProtein: 0, targetCarbs: 0, targetFat: 0 };

    // Active calories are only one part of expenditure. Keep Home and the
    // weekly plan on the same estimate instead of changing targets by device.

    const waterConsumed = waterAgg._sum.amountMl ?? 0;
    const waterTarget = onboarding?.weight != null ? Math.round(onboarding.weight * 35) : 0;

    const nutrition = {
        calories: { consumed: Math.round(consumed.calories), target: targets.targetCalories },
        protein:  { consumed: Math.round(consumed.protein),  target: targets.targetProtein  },
        carbs:    { consumed: Math.round(consumed.carbs),    target: targets.targetCarbs    },
        fat:      { consumed: Math.round(consumed.fat),      target: targets.targetFat      },
        water:    { consumed: waterConsumed,                 target: waterTarget            },
    };

    // ── Weekly streak dots (Mon–Sun, status & calendar date) ─────────────────
    // Calculate dates for Mon-Sun of current week
    const weeklyStreak: WeekDay[] = DAYS_OF_WEEK.map((d, i) => {
        const dateForDay = new Date(currentMonday);
        dateForDay.setDate(currentMonday.getDate() + i);
        const dateKey = `${dateForDay.getFullYear()}-${String(dateForDay.getMonth() + 1).padStart(2, '0')}-${String(dateForDay.getDate()).padStart(2, '0')}`;
        const session = weekSessions.find(row => row.date === dateKey);
        const rest = weekRestDays.some(row => row.date === dateKey);
        return {
            day: DAY_LABELS[i],
            dateNum: dateForDay.getDate(),
            status: (session?.status ?? (rest ? 'REST_DAY' :
                allWorkoutItems.some(item => item.dayOfWeek === d) ? 'NOT_STARTED' : 'UNAVAILABLE')) as WeekDay["status"],
            isToday: i === prismaIndex,
        };
    });

    const result: HomeData = {
        dataVersion: 15,
        wearableUsage: userRecord?.wearableUsage ?? 'UNKNOWN',
        healthMetrics: hkSnapshot ? { date: sleepDate,
            source: hkSnapshot.sourceProvider === 'GOOGLE_HEALTH_CONNECT' ? 'health_connect' :
                hkSnapshot.sourceProvider === 'APPLE_HEALTHKIT' ? 'healthkit' : 'manual',
            syncedAt: hkSnapshot.updatedAt.toISOString(), steps: hkSnapshot.steps,
            activeCalories: hkSnapshot.activeCalories, sleepMinutes: hkSnapshot.sleepTotalMinutes,
            restingHR: hkSnapshot.restingHR, hrv: hkSnapshot.hrv, hrvMethod: hkSnapshot.hrvMethod } : null,
        calendarDate: sleepDate,
        sleepLog: manualSleep ? { date: sleepDate, sleepMinutes: manualSleep.sleepMinutes, energy: manualSleep.energy,
            rested: manualSleep.rested, soreness: manualSleep.soreness, source: manualSleep.source, updatedAt: manualSleep.updatedAt.toISOString() } : null,
        user: { name: userName, email: userRecord?.email, streakDays },
        readiness,
        todayWorkout,
        nutrition,
        weeklyStreak,
    };

    // The Today screen remains available if the optional cache is offline.
    await redis.set(cacheKey, result, { ex: HOME_CACHE_TTL }).catch(() => undefined);
    return result;
}

// Count consecutive days (today backwards) where user has any meal log or completed workout item
async function calcStreak(userId: string, anchor: Date): Promise<number> {
    let streak = 0;
    const now = new Date(anchor);

    for (let i = 0; i < 365; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const day   = String(d.getDate());
        const month = String(d.getMonth() + 1);
        const year  = String(d.getFullYear());
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const startOfNextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

        const [mealCount, workoutCount] = await Promise.all([
            prisma.userMealLog.count({ where: { userId, day, month, year, ...realMealWhere } }),
            prisma.userWorkoutItem.count({
                where: {
                    sourceProvider: "USER",
                    status: "COMPLETED",
                    completedAt: { gte: startOfDay, lt: startOfNextDay },
                    userWorkout: { userId },
                },
            }),
        ]);

        if (mealCount > 0 || workoutCount > 0) {
            streak++;
        } else {
            break; // streak broken
        }
    }

    return streak;
}
