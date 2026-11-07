import { getTrainingMap } from "../modules/heatmap/training_map_service";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import redis from "../config/redis";
import routes from "../modules/progress/progress_routes";
import {
  getProgressOverview,
  getMuscle,
} from "../modules/progress/progress_service";
import {
  getExercise,
  getExercises,
  getExerciseRank,
} from "../modules/progress/training/exercise_service";
import { getBodyProgress } from "../modules/progress/body/body_service";
import { getSessions } from "../modules/progress/training/session_service";
import { getWellnessProgress } from "../modules/progress/wellness/wellness_service";
import { invalidateProgress } from "../modules/progress/progress_cache";
import {
  calendarDate,
  ListQuery,
  listQuery,
} from "../modules/progress/progress_types";
import { mapExercise } from "../modules/heatmap/training_map_engine";
import { shiftDate } from "../modules/progress/progress_range";

async function main() {
  const owner = await prisma.user.create({
    data: {
      email: `progress-${randomUUID()}@example.invalid`,
      password: "isolated-test",
    },
  });
  const other = await prisma.user.create({
    data: {
      email: `progress-${randomUUID()}@example.invalid`,
      password: "isolated-test",
    },
  });
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const query: ListQuery = {
    period: "4w",
    date: today,
    utcOffsetMinutes: 330,
    limit: 1,
    search: "",
  };
  const app = express();
  app.use("/api/progress", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/progress`;
  const headers = {
    authorization: `Bearer ${jwt.sign({ userId: owner.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}`,
  };
  const exercises: string[] = [];
  try {
    assert.equal(calendarDate.safeParse("2026-02-30").success, false);
    assert.equal(
      listQuery.safeParse({
        ...query,
        period: "custom",
        start: today,
        end: shiftDate(today, -1),
      }).success,
      false,
    );
    assert.equal(
      listQuery.safeParse({
        ...query,
        period: "custom",
        start: "2026-02-30",
        end: today,
      }).success,
      false,
    );
    assert.deepEqual(
      mapExercise({
        id: "test",
        name: "Lower Back Curl",
        target: "Spine",
        muscleGroup: "Glutes",
        bodyPart: "Back",
        secondaryMuscles: [],
      }).primary,
      ["lower_back"],
    );
    assert.equal((await fetch(`${base}?date=${today}`)).status, 401);
    assert.equal(
      (await fetch(`${base}?date=2026-02-30`, { headers })).status,
      400,
    );
    assert.equal(
      (await fetch(`${base}?date=${shiftDate(today, 1)}`, { headers })).status,
      400,
    );
    const bench = await prisma.workout.create({
      data: {
        name: `Test bench ${randomUUID()}`,
        description: "Isolated test",
        category: "strength",
        bodyPart: "chest",
        target: "pectorals",
        secondaryMuscles: ["triceps", "shoulders"],
        equipment: "barbell",
        instructions: [],
        namesByLang: { de: "Test-Bankdrücken" },
      },
    });
    exercises.push(bench.id);
    const pushup = await prisma.workout.create({
      data: {
        name: `Test push up ${randomUUID()}`,
        description: "Isolated test",
        category: "strength",
        bodyPart: "chest",
        target: "pectorals",
        secondaryMuscles: ["triceps"],
        equipment: "body weight",
        instructions: [],
      },
    });
    exercises.push(pushup.id);
    for (const [index, ago] of [45, 21, 14, 7, 0].entries()) {
      const date = shiftDate(today, -ago);
      const plan = await prisma.userWorkout.create({
        data: { userId: owner.id, weekLabel: "test", scheduledDate: date },
      });
      await prisma.workoutSession.create({
        data: {
          userId: owner.id,
          userWorkoutId: plan.id,
          date,
          name: "Upper body",
          status: index === 4 ? "IN_PROGRESS" : "COMPLETED",
          durationSeconds: index === 4 ? null : 2400,
        },
      });
      for (const [workoutId, weight, reps] of [
        [bench.id, 40 + index * 5, 8],
        [pushup.id, null, 10 + index],
      ] as const) {
        const item = await prisma.userWorkoutItem.create({
          data: {
            userWorkoutId: plan.id,
            workoutId,
            dayOfWeek: "THURSDAY",
            sourceProvider: "USER",
          },
        });
        await prisma.workoutSetLog.create({
          data: {
            userId: owner.id,
            userWorkoutItemId: item.id,
            setNumber: 1,
            weight,
            reps,
            rpe: index === 4 ? 8 : null,
            year: date.slice(0, 4),
            month: String(Number(date.slice(5, 7))),
            day: String(Number(date.slice(8, 10))),
          },
        });
      }
    }
    const previewPlan = await prisma.userWorkout.create({
      data: { userId: owner.id, weekLabel: "preview" },
    });
    const previewItem = await prisma.userWorkoutItem.create({
      data: {
        userWorkoutId: previewPlan.id,
        workoutId: bench.id,
        dayOfWeek: "THURSDAY",
        sourceProvider: "PREVIEW",
      },
    });
    await prisma.workoutSetLog.create({
      data: {
        userId: owner.id,
        userWorkoutItemId: previewItem.id,
        setNumber: 1,
        weight: 999,
        reps: 10,
        year: today.slice(0, 4),
        month: today.slice(5, 7),
        day: today.slice(8, 10),
      },
    });
    await prisma.healthKitSnapshot.create({
      data: {
        userId: owner.id,
        date: today,
        weight: 75,
        recoveryScore: 80,
        hrv: 60,
        sleepTotalMinutes: 450,
        sourceProvider: "HEALTH_CONNECT",
      },
    });
    await prisma.healthKitSnapshot.create({
      data: {
        userId: owner.id,
        date: shiftDate(today, -1),
        weight: 999,
        recoveryScore: 99,
        sourceProvider: "TODAY_PREVIEW",
      },
    });
    for (const [ago, source, value] of [
      [21, "tape", 90],
      [0, "tape", 92],
      [0, "contour_estimate", 91],
    ] as const) {
      await prisma.bodyAssessment.create({
        data: {
          userId: owner.id,
          recordedDate: shiftDate(today, -ago),
          metrics: {
            chestCm: {
              source,
              value,
              ...(source === "contour_estimate" ? { low: 88, high: 94 } : {}),
            },
            weightKg: { value: 76, source: "profile" },
          },
          observations: [],
          quality: {},
          method: "entered",
        },
      });
    }
    const overview = await getProgressOverview(owner.id, query, "en");
    assert.equal(
      overview.summary.sets,
      8,
      "Recorded dates, not insertion timestamps, determine the selected range",
    );
    assert.equal(
      overview.summary.workouts,
      3,
      "An active session is not a completed workout",
    );
    assert.equal(
      overview.muscles.find((row) => row.id === "chest")!.directSets,
      8,
    );
    assert.equal(
      overview.muscles.find((row) => row.id === "triceps")!.assistingSets,
      8,
    );
    assert.equal(
      overview.muscles.find((row) => row.id === "triceps")!.directSets,
      0,
    );
    assert.equal(overview.wellness.recovery.length, 1);
    assert.equal(overview.wellness.nutrition.length, 0);
    const detail = await getExercise(owner.id, bench.id, query, "de");
    assert.equal(detail.exercise.name, "Test-Bankdrücken");
    assert.equal(detail.series.length, 4);
    assert.equal(detail.records.bestLoad!.weight, 60);
    assert.equal(detail.history.length, 1);
    assert.equal(
      detail.rank!.trainingDays,
      5,
      "Ranks use all history even when charts show four weeks.",
    );
    assert.equal(detail.rank!.tier, 2);
    assert.equal(detail.rank!.badges[1]!.earned, true);
    const personalRank = await getExerciseRank(owner.id, bench.id, query);
    assert.deepEqual(personalRank, detail.rank);
    assert.equal((await getExerciseRank(other.id, bench.id, query)).tier, 0);
    assert.equal(
      (await fetch(base + "/exercises/" + bench.id + "/rank?date=" + today))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(
          base +
            "/exercises/" +
            bench.id +
            "/rank?date=" +
            today +
            "&dataset=preview",
          { headers },
        )
      ).status,
      400,
    );
    const rankResponse = await fetch(
      base +
        "/exercises/" +
        bench.id +
        "/rank?date=" +
        today +
        "&period=4w&dataset=real",
      { headers },
    );
    assert.equal(rankResponse.status, 200);
    const rankBody: any = await rankResponse.json();
    assert.equal(
      rankBody.data.loggedSets,
      5,
      "Public rank requests never count preview logs.",
    );
    assert.equal(
      rankBody.data.strengthRank.tier,
      0,
      "Unconfirmed load units must not invent a strength level.",
    );
    await prisma.onboarding.create({
      data: {
        userId: owner.id,
        name: "Rank test",
        age: 30,
        gender: "MALE",
        height: 180,
        weight: 80,
        workingToward: "BUILD_MUSCLE",
        experience: "BEGINNER",
        daysPerWeek: "DAYS_3",
        workoutDuration: "MIN_45",
        trainingLocation: "GYM",
        equipment: ["BARBELLS"],
        activityLevel: "MODERATE",
        sleepDuration: "HOURS_7_TO_8",
        eatingStyle: "NO_PREFERENCE",
        limitations: ["NONE"],
      },
    });
    await prisma.workout.update({
      where: { id: bench.id },
      data: { name: "Barbell  Bench Press" },
    });
    await prisma.userWorkoutItem.updateMany({
      where: {
        workoutId: bench.id,
        sourceProvider: "USER",
        userWorkout: { userId: owner.id },
      },
      data: {
        setTargets: {
          weightBasis: "as_logged",
          weightUnit: "total_load",
          sets: [1, 2, 3].map((setNumber) => ({
            setNumber,
            repsMin: 8,
            repsMax: 8,
            weightKg: 40,
          })),
        },
      },
    });
    const actualStrength = await getExerciseRank(owner.id, bench.id, query);
    assert.equal(actualStrength.strengthRank.tier, 1);
    assert.equal(
      actualStrength.strengthRank.bodyWeightKg,
      80,
      "Profile-source size entries do not replace an actual scale weight.",
    );
    assert.equal(actualStrength.strengthBadges.length, 5);
    const bodyMap = await getTrainingMap(owner.id, today, 330);
    assert.equal(
      bodyMap.regions.find((region) => region.id === "chest")!.strength.tier,
      actualStrength.strengthRank.tier,
    );
    await invalidateProgress(owner.id);
    const refreshedStrength: any = await (
      await fetch(base + "/exercises/" + bench.id + "/rank?date=" + today, {
        headers,
      })
    ).json();
    assert.equal(
      refreshedStrength.data.strengthRank.tier,
      actualStrength.strengthRank.tier,
      "Profile and load-unit changes must refresh the cached rank.",
    );

    assert(detail.nextCursor);
    const next = await getExercise(
      owner.id,
      bench.id,
      { ...query, cursor: detail.nextCursor! },
      "en",
    );
    assert.notEqual(next.history[0]!.date, detail.history[0]!.date);
    const bodyweight = await getExercise(owner.id, pushup.id, query, "en");
    assert.equal(bodyweight.series[0]!.estimatedStrength, null);
    assert.equal(bodyweight.series[0]!.volume, null);
    const all = await getExercise(
      owner.id,
      bench.id,
      { ...query, period: "all" },
      "en",
    );
    assert.equal(all.series.length, 5);
    const custom = {
      ...query,
      period: "custom" as const,
      start: shiftDate(today, -14),
      end: shiftDate(today, -7),
    };
    const customDetail = await getExercise(owner.id, bench.id, custom, "en");
    assert.equal(customDetail.series.length, 2);
    assert.equal(customDetail.series.at(-1)!.date, custom.end);
    assert.equal(customDetail.records.bestLoad!.weight, 55);
    await assert.rejects(getExercise(other.id, bench.id, query, "en"));
    const list = await getExercises(owner.id, query, "en");
    assert.equal(list.items.length, 1);
    assert(list.nextCursor);
    const page = await getExercises(
      owner.id,
      { ...query, cursor: list.nextCursor! },
      "en",
    );
    assert.notEqual(list.items[0]!.id, page.items[0]!.id);
    const muscle = await getMuscle(owner.id, "chest", query, "en");
    assert.equal(muscle.muscle.directSets, 8);
    const body = await getBodyProgress(owner.id, query);
    assert.equal(
      body.metrics.find((row) => row.id === "chestCm")!.series.length,
      2,
    );
    assert.equal(
      body.metrics
        .find((row) => row.id === "chestCm")!
        .series.find((row) => row.source === "tape")!.change,
      2,
    );
    assert.equal(
      body.metrics.find((row) => row.id === "weightKg")!.series.length,
      1,
      "Profile values are not repeated scale readings",
    );
    const sessions = await getSessions(owner.id, { ...query, limit: 30 }, "en");
    assert.equal(sessions.items.length, 4);
    assert.equal(sessions.items[0]!.sets, 2);
    const wellness = await getWellnessProgress(owner.id, query);
    assert.equal(wellness.recovery[0]!.sleep, 7.5);
    const response = await fetch(`${base}?date=${today}&utcOffsetMinutes=330`, {
      headers,
    });
    assert.equal(response.status, 200);
    const updated = await prisma.workoutSetLog.findFirst({
      where: { userId: owner.id, weight: 60 },
    });
    await prisma.workoutSetLog.update({
      where: { id: updated!.id },
      data: { weight: 65 },
    });
    await invalidateProgress(owner.id);
    const refreshed: any = await (
      await fetch(`${base}/exercises/${bench.id}?date=${today}`, { headers })
    ).json();
    assert.equal(refreshed.data.records.bestLoad.weight, 65);
    const output = path.resolve(__dirname, "../../mobile/build");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "progress-test-overview.json"),
      JSON.stringify(overview),
    );
    fs.writeFileSync(
      path.join(output, "progress-test-exercise.json"),
      JSON.stringify(detail),
    );
    const account = await prisma.user.findUnique({
      where: { email: "vklvl0101@gmail.com" },
      select: { id: true },
    });
    if (account) {
      const real = await getProgressOverview(account.id, query, "en");
      fs.writeFileSync(
        path.join(output, "progress-real-overview.json"),
        JSON.stringify(real),
      );
      const preview = await getProgressOverview(
        account.id,
        { ...query, dataset: "preview", period: "all" },
        "en",
      );
      if (preview.hasPreview) {
        assert(preview.summary.workouts >= 17);
        assert(preview.summary.sets > 150);
        assert(preview.muscles.every((muscle) => muscle.directSets > 0));
        assert.equal(preview.wellness.recovery.length, 30);
        assert.equal(preview.wellness.nutrition.length, 30);
        assert.equal(
          (
            await getProgressOverview(
              other.id,
              { ...query, dataset: "preview" },
              "en",
            )
          ).summary.sets,
          0,
        );
        fs.writeFileSync(
          path.join(output, "progress-seeded-preview.json"),
          JSON.stringify(preview),
        );
        assert.equal(
          (await getProgressOverview(account.id, query, "en")).summary.sets,
          real.summary.sets,
        );
      }
    }
    const firstLog = await prisma.workoutSetLog.findFirst({
      where: { userId: owner.id, weight: 40 },
    });
    await prisma.workoutSetLog.delete({ where: { id: firstLog!.id } });
    await invalidateProgress(owner.id);
    const changedRank: any = await (
      await fetch(base + "/exercises/" + bench.id + "/rank?date=" + today, {
        headers,
      })
    ).json();
    assert.equal(changedRank.data.trainingDays, 4);
    assert.equal(
      changedRank.data.badges[1].earned,
      false,
      "Deleting logs refreshes cached badges.",
    );
    console.log(
      "Progress contracts passed: dates, ownership, preview exclusion, records, muscle exposure, sources, pagination and cache invalidation.",
    );
  } finally {
    server.close();
    for (const id of [owner.id, other.id]) {
      const keys = await redis.keys(`history:progress:${id}:*`).catch(() => []);
      if (keys.length) await redis.del(...keys);
      await redis.del(`progress-revision:${id}`);
      await prisma.user.delete({ where: { id } });
    }
    await prisma.workout.deleteMany({ where: { id: { in: exercises } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
