import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { invalidateProgress } from "../progress/progress_cache";
import { z } from "zod";
import { wellnessInput } from "./wellness_types";
import { buildDailyReadiness } from '../home/home_service';
import { realSnapshotWhere } from '../../utils/real_data';
import { sleepEditError } from './sleep_edit_window';
export class WellnessInputError extends Error {}

async function settleCacheCleanup(cleanup: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    cleanup.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 1500);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

export async function getWearablePreference(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { wearableUsage: true },
  });
  return { usage: user.wearableUsage };
}

export async function saveWearablePreference(
  userId: string,
  usage: "UNKNOWN" | "WEARABLE" | "NONE",
) {
  await prisma.user.update({
    where: { id: userId },
    data: { wearableUsage: usage },
  });
  await settleCacheCleanup(
    Promise.all([redis.del(`home:${userId}`), invalidateProgress(userId)]),
  );
  return { usage };
}

export async function getWellnessEntry(userId: string, date: string) {
  const entry = await prisma.dailyWellnessEntry.findUnique({
    where: { userId_date: { userId, date } },
    select: {
      date: true,
      sleepMinutes: true,
      energy: true,
      rested: true,
      soreness: true,
      source: true,
      sleepStartedAt: true,
      sleepEndedAt: true,
      updatedAt: true,
    },
  });
  return entry;
}

export async function saveWellnessEntry(
  userId: string,
  date: string,
  input: Omit<z.infer<typeof wellnessInput>, "utcOffsetMinutes">,
  utcOffsetMinutes = 0,
) {
  const editError = sleepEditError(date, utcOffsetMinutes);
  if (editError) throw new WellnessInputError(editError);
  const data = {
    ...input,
    sleepStartedAt: input.sleepStartedAt
      ? new Date(input.sleepStartedAt)
      : null,
    sleepEndedAt: input.sleepEndedAt ? new Date(input.sleepEndedAt) : null,
  };
  const hasFallback = input.source === "phone_estimate_confirmed";
  if (input.source === "phone_estimate_confirmed") {
    const start = data.sleepStartedAt?.getTime(),
      end = data.sleepEndedAt?.getTime();
    if (
      start == null ||
      end == null ||
      end <= start ||
      end > Date.now() ||
      Math.round((end - start) / 60000) !== input.sleepMinutes ||
      new Date(end + utcOffsetMinutes * 60000).toISOString().slice(0, 10) !==
        date
    ) {
      throw new WellnessInputError(
        "Check the estimated sleep times and wake-up date.",
      );
    }
  } else if (data.sleepStartedAt || data.sleepEndedAt) {
    throw new WellnessInputError(
      "Entered sleep must not contain device estimate timestamps.",
    );
  }
  const saved = await prisma.$transaction(async (tx) => {
    // Lock the preference while saving so an account switching to a wearable
    // cannot concurrently accept new fallback fields.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { wearableUsage: true },
    });
    if (hasFallback && user.wearableUsage !== "NONE")
      throw new WellnessInputError(
        "Confirm that you do not use a wearable before using this check-in.",
      );
    const entry = await tx.dailyWellnessEntry.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });
    const [year, month, day] = date.split('-');
    const [health, manual] = await Promise.all([
      tx.healthKitSnapshot.findFirst({ where: { userId, date, ...realSnapshotWhere } }),
      tx.readiness.findFirst({ where: { userId, year,
        month: { in: [month, String(Number(month))] },
        day: { in: [day, String(Number(day))] } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return { entry, wearableUsage: user.wearableUsage,
      readiness: buildDailyReadiness(date, user.wearableUsage, health, entry, manual) };
  });
  const cleanup = Promise.all([
    invalidateProgress(userId),
    redis
      .keys(`history:recovery:${userId}:*`)
      .then((history) => redis.del(`home:${userId}`, ...history))
      .catch(() => undefined),
  ]).catch(() => undefined);
  // Cache outages must not turn a committed database save into an HTTP timeout.
  await settleCacheCleanup(cleanup);
  const { userId: _owner, id: _id, ...entry } = saved.entry;
  return { ...entry, wearableUsage: saved.wearableUsage, readiness: saved.readiness };
}
