import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { DayOfWeek } from "@prisma/client";
import prisma from "../config/prisma";
import { addDays, dateInZone } from "../graphworkflow/common/types";
import { weekday } from "../modules/workout/session/session_types";
import { exerciseStrength, loadStrengthProfile, strengthReference } from "../modules/progress/training/strength_rank";
import { getTrainingMap } from "../modules/heatmap/training_map_service";
import { invalidateProgress } from "../modules/progress/progress_cache";

// Explicitly requested visual sample for this test account only.
// Run with --apply to insert, or --remove to delete only this script's records.
const email = "vklvl0101@gmail.com";
const seed = "training-colour-sample-v1";
const today = dateInZone("Asia/Kolkata");
const receiptPath = "seed-results/training-colours.json";

function id(key: string) {
  return createHash("sha256").update(seed + ":" + email + ":" + key).digest("hex").slice(0, 32);
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const userId = user.id;

  if (process.argv.includes("--remove")) {
    const removed = await prisma.userWorkout.deleteMany({
      where: { userId, weekLabel: seed, aiNote: { startsWith: "SAMPLE:" } },
    });
    await invalidateProgress(userId);
    console.log({ removedSampleWorkouts: removed.count });
    return;
  }

  const profile = await loadStrengthProfile(userId, today);
  if (!profile) throw new Error("Complete this test account's onboarding first.");

  const existing = await prisma.userWorkout.count({ where: { userId, weekLabel: seed } });
  if (existing) {
    console.log({ message: "Samples already exist. Use --remove before reseeding.", sampleWorkouts: existing });
    return;
  }

  const exercises = await prisma.workout.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, equipment: true, target: true, muscleGroup: true, bodyPart: true, secondaryMuscles: true },
  });
  const supported = exercises.filter((exercise) => strengthReference(exercise));
  const sessions = await prisma.workoutSession.findMany({ where: { userId }, select: { date: true } });
  const plans = await prisma.userWorkout.findMany({ where: { userId }, select: { scheduledDate: true } });
  const occupied = new Set([...sessions.map((row) => row.date), ...plans.map((row) => row.scheduledDate)]);
  const dates: string[] = [];
  for (let daysAgo = 1; daysAgo <= 80 && dates.length < 2; daysAgo++) {
    const date = addDays(today, -daysAgo);
    if (!occupied.has(date)) dates.push(date);
  }
  if (dates.length !== 2) throw new Error("No two available dates. No data was changed.");

  // Deliberately varied example performances, never recommended lifting targets.
  const choices = [
    { reference: "bench-press", tier: 3 },
    { reference: "squat", tier: 2 },
    { reference: "barbell-curl", tier: 1 },
    { reference: "lying-tricep-extension", tier: 5 },
    { reference: "wrist-curl", tier: 4 },
    { reference: "bent-over-row", tier: 2 },
    { reference: "deadlift", tier: 3 },
  ];
  const examples = choices.map((choice) => {
    const exercise = supported.find((row) => strengthReference(row)!.id === choice.reference);
    if (!exercise) throw new Error("Missing exercise: " + choice.reference);
    const rank = exerciseStrength([], exercise, profile, today);
    const floor = rank.thresholds[choice.tier - 1]?.weightKg;
    if (floor == null) throw new Error("Profile is outside the available adult references.");
    const ceiling = rank.thresholds[choice.tier]?.weightKg ?? floor * 1.15;
    const weight = Math.round(((floor + ceiling) / 2) / (1 + 8 / 30) * 10) / 10;
    return { exercise, tier: choice.tier, weight, weightUnit: rank.weightUnit! };
  });
  const summary = { email, seed, dates, exercises: examples.map((row) => ({
    name: row.exercise.name, tier: row.tier, weightKg: row.weight, reps: 8, weightUnit: row.weightUnit,
  })) };
  if (!process.argv.includes("--apply")) {
    console.log({ dryRun: true, ...summary });
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const date of dates) {
      const time = new Date(date + "T17:00:00+05:30");
      const [year, month, day] = date.split("-");
      const workout = await tx.userWorkout.create({ data: {
        id: id("workout:" + date), userId, scheduledDate: date, weekLabel: seed,
        status: "COMPLETED", createdAt: time,
        aiNote: "SAMPLE: Training colour preview. Synthetic performances, not exercise recommendations.",
        session: { create: {
          id: id("session:" + date), userId, date, name: "Sample · Training colours",
          status: "COMPLETED", startedAt: time, finishedAt: new Date(time.getTime() + 3600000), durationSeconds: 3600,
        } },
      } });

      for (const [index, row] of examples.entries()) {
        const item = await tx.userWorkoutItem.create({ data: {
          id: id("item:" + date + ":" + index), userWorkoutId: workout.id, workoutId: row.exercise.id,
          dayOfWeek: weekday(date) as DayOfWeek, orderIndex: index, targetSets: 3, targetReps: "8",
          targetWeight: row.weight, setTargets: { weightUnit: row.weightUnit, synthetic: true, seed },
          sourceProvider: "USER", status: "COMPLETED", completedAt: time, createdAt: time,
        } });
        await tx.workoutSetLog.createMany({ data: [1, 2, 3].map((setNumber) => ({
          id: id("set:" + date + ":" + index + ":" + setNumber), userId,
          userWorkoutItemId: item.id, clientKey: seed + ":" + date + ":" + index + ":" + setNumber,
          setNumber, weight: row.weight, reps: 8, rpe: 7,
          year: year!, month: String(Number(month)), day: String(Number(day)), createdAt: time,
        })) });
      }
    }
  }, { timeout: 20000 });

  await invalidateProgress(userId);
  const map = await getTrainingMap(userId, today, 330, "en");
  const colours = map.regions.map((region) => ({ muscle: region.id, level: region.strength.title, tier: region.strength.tier }));
  await mkdir("seed-results", { recursive: true });
  await writeFile(receiptPath, JSON.stringify({ ...summary, colours, removeCommand: "node --use-system-ca --import tsx scripts/seed_training_colours.ts --remove" }, null, 2));
  console.log({ sampleWorkouts: 2, sampleSets: 42, colours, receiptPath });
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
