import {generateTokens} from "../modules/auth/auth_service";
import {preferredExerciseMedia} from '../utils/exercise_media';
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../config/prisma";
import {
  Snapshot,
  REGIONS,
  PlannerError,
  dateInZone,
} from "../graphworkflow/common/types";
import {
  buildStarterFallback,
  generateStarterWithFallback,
} from "../graphworkflow/starter_fallback";
import {
  sessionQualityIssues,
  workloadOverages,
} from "../graphworkflow/common/session_quality";
import { trainingSchedule } from "../graphworkflow/nodes/prepare_node";
import { starterPreview } from "../graphworkflow/starter_preview";
import { recommendMeals } from "../graphworkflow/nodes/nutrition_node";
import { validatePlan } from "../graphworkflow/nodes/validation_node";
import {
  requestStarter,
  getStarter,
  assertStarterReady,
} from "../graphworkflow/starter_service";
import {
  getRun,
  getSavedPlan,
  listPlans,
  saveCompletedPlan,
  activatePlan,
  assertFreshPlan,
} from "../graphworkflow/service";
import { startTrial } from "../modules/subscription/subscription_service";
import { EQUIPMENT_CATEGORIES } from "../modules/onboarding/equipment_catalog";

function fixture(gender = "FEMALE"): Snapshot {
  return {
    version: 1,
    onboardingStarter: true,
    userId: randomUUID(),
    weekStart: "2026-10-19",
    timezone: "Europe/London",
    cutoff: "2026-10-18",
    historyStart: "2026-09-28",
    synthetic: false,
    profile: {
      age: 30,
      gender,
      height: 170,
      weight: 70,
      targetWeight: 70,
      goal: "BUILD_MUSCLE",
      experience: "BEGINNER",
      daysPerWeek: 3,
      minutes: 30,
      trainingDays: [],
      trainingSplit: "AUTO",
      equipment: ["DUMBBELLS"],
      equipmentIds: ["dumbbells"],
      location: "HOME",
      limitations: ["NONE"],
      customLimitations: null,
      focusMuscles: ["chest"],
      language: "en",
      eatingStyle: "NO_PREFERENCE",
      activityLevel: "MODERATE",
      allergies: [],
      dislikes: [],
      countryCode: "GB",
      budgetAmount: null,
      budgetCurrency: null,
    },
    candidates: REGIONS.map((region) => ({
      id: randomUUID(),
      name: {
        chest: "Dumbbell floor press",
        back: "Dumbbell bent over row",
        legs: "Dumbbell goblet squat",
        shoulders: "Dumbbell lateral raise",
        biceps: "Dumbbell curl",
        triceps: "Dumbbell triceps extension",
        core: "Dumbbell crunch",
      }[region],
      region,
      pattern:
        region === "chest"
          ? "push"
          : region === "back"
            ? "pull"
            : region === "legs"
              ? "squat"
              : region,
      equipment: "dumbbell",
      primary: [
        region === "back" ? "lats" : region === "legs" ? "quads" : region,
      ],
      secondary: [],
      compound: ["chest", "back", "legs"].includes(region),
      bodyweight: false,
      requiresBench: false,
      subTarget: region,
      difficulty: "beginner",
    })),
    foods: [],
    sets: [],
    sessions: [],
    wellness: [],
    health: [],
    meals: [],
    water: [],
    measurements: [],
    coverage: { loggedDays: 0, weeksWithLogs: 0, syntheticDays: 0 },
  };
}

async function unit() {
  const snapshot = fixture();
  const female = await buildStarterFallback(snapshot);
  validatePlan(snapshot, female);
  assert.equal(female.workouts.filter((day) => !day.restDay).length, 3);
  assert(
    female.workouts
      .filter((day) => !day.restDay)
      .every((day) => day.exercises.length > 0),
  );
  assert(
    female.workouts
      .flatMap((day) => day.exercises)
      .every(
        (exercise) =>
          exercise.weightKg === null &&
          exercise.weightBasis === "establish_starting_load",
      ),
  );
  assert.equal(female.nutrition.status, "NEEDS_INPUT");
  const unmeasured = {...snapshot, profile: {...snapshot.profile, height: null, weight: null, targetWeight: null}};
  const unmeasuredPlan = await buildStarterFallback(unmeasured);
  validatePlan(unmeasured, unmeasuredPlan);
  assert.deepEqual(unmeasuredPlan.workouts, female.workouts, "Training is ready without body measurements.");
  const nutrition = await recommendMeals(unmeasured, unmeasuredPlan, { generate: () => { throw new Error("Missing measurements must not reach a provider"); } } as unknown as Parameters<typeof recommendMeals>[2]);
  assert.equal(nutrition.status, "NEEDS_INPUT");
  assert.equal(nutrition.targets, null);
  const male = await buildStarterFallback({
    ...snapshot,
    profile: { ...snapshot.profile, gender: "MALE" },
  });
  assert.deepEqual(
    male.workouts,
    female.workouts,
    "Gender alone must not invent strength differences.",
  );
  const preview = starterPreview(female);
  assert.equal(preview.source, "rules");
  assert(preview.muscleGroups.some((group) => group.region === "chest"));
  assert(preview.muscleGroups.some((group) => group.region === "back"));
  assert(preview.muscleGroups.some((group) => group.region === "legs"));
  assert(preview.muscleGroups.some((group) => group.lockedCount > 0));
  assert.equal(
    preview.muscleGroups.flatMap((group) => group.exercises).length,
    2,
  );
  for (const group of preview.muscleGroups) {
    assert.equal(
      group.exerciseCount,
      group.lockedCount + group.exercises.length,
    );
  }
  assert(preview.firstWorkout!.exercises.length <= 2);
  assert(!("exercises" in preview.workouts[0]!));
  assert(!JSON.stringify(preview).includes("setPrescriptions"));
  const fallback = await generateStarterWithFallback(async () => {
    throw new PlannerError("MODEL_UNAVAILABLE", "test outage", 503);
  }, snapshot);
  assert.equal(fallback.model, "starter:rules-v1");
  const qualityFallback = await generateStarterWithFallback(async () => {
    throw new PlannerError(
      "PLAN_QUALITY",
      "The reviewer rejected overlapping muscle workload.",
    );
  }, snapshot);
  validatePlan(snapshot, qualityFallback);
  assert.equal(qualityFallback.model, "starter:rules-v1");

  // A complete intermediate profile used to fail from the combined shoulder
  // work in independent chest, back and shoulder recommendations.
  const overlap = fixture();
  Object.assign(overlap.profile, {
    experience: "INTERMEDIATE",
    location: "GYM",
    daysPerWeek: 5,
    minutes: 60,
    trainingSplit: "MUSCLE_FOCUSED",
    equipment: ["DUMBBELLS", "BENCH"],
    equipmentIds: ["dumbbells", "flat_bench"],
    focusMuscles: [],
  });
  const names: Record<string, string[]> = {
    chest: [
      "Dumbbell floor press",
      "Dumbbell fly",
      "Dumbbell incline chest press",
    ],
    back: [
      "Dumbbell bent over row",
      "Dumbbell pullover",
      "Dumbbell supported row",
    ],
    legs: [
      "Dumbbell goblet squat",
      "Dumbbell Romanian deadlift",
      "Dumbbell calf raise",
    ],
    shoulders: [
      "Dumbbell shoulder press",
      "Dumbbell lateral raise",
      "Dumbbell rear delt fly",
      "Dumbbell front raise",
    ],
    biceps: [
      "Dumbbell curl",
      "Dumbbell hammer curl",
      "Dumbbell concentration curl",
    ],
    triceps: [
      "Dumbbell triceps extension",
      "Dumbbell triceps kickback",
      "Dumbbell overhead triceps extension",
    ],
    core: ["Dumbbell crunch", "Dumbbell side bend", "Dumbbell Russian twist"],
  };
  overlap.candidates = overlap.candidates.flatMap((candidate) =>
    names[candidate.region]!.map((name, i) => ({
      ...candidate,
      id: randomUUID(),
      name,
      subTarget: `${candidate.region}-${i}`,
      secondary:
        candidate.region === "chest"
          ? ["triceps", "shoulders"]
          : candidate.region === "back"
            ? ["biceps", "shoulders"]
            : [],
    })),
  );
  const balanced = await buildStarterFallback(overlap);
  validatePlan(overlap, balanced);
  assert.equal(balanced.workouts.filter((day) => !day.restDay).length, 5);
  assert.deepEqual(workloadOverages(overlap, balanced.workouts), []);
  assert.deepEqual(
    sessionQualityIssues(overlap, balanced, trainingSchedule(overlap)),
    [],
  );
  assert(
    balanced.workouts
      .flatMap((day) => day.exercises)
      .every(
        (exercise) =>
          exercise.sets >= 2 &&
          exercise.sets === exercise.setPrescriptions.length,
      ),
  );
  await assert.rejects(
    () =>
      generateStarterWithFallback(async () => {
        throw new PlannerError("STALE_PLAN", "test");
      }, snapshot),
    /test/,
  );

  // Shoulder injury produces a backup plan with the rest of the body (no shoulder/overhead exercises).
  const shoulderSnapshot: Snapshot = {
    ...snapshot,
    profile: { ...snapshot.profile, limitations: ["SHOULDER"] },
    candidates: [
      ...snapshot.candidates,
      {
        ...snapshot.candidates[0]!,
        id: randomUUID(),
        name: "Dumbbell overhead press",
        region: "shoulders",
        primary: ["shoulders"],
      },
    ],
  };
  const shoulderPlan = await buildStarterFallback(shoulderSnapshot);
  validatePlan(shoulderSnapshot, shoulderPlan);
  assert(
    shoulderPlan.workouts
      .flatMap((d) => d.exercises)
      .every((e) => e.region !== "shoulders" && !/overhead/i.test(e.name)),
    "Shoulder backup plan excludes shoulder and overhead exercises.",
  );
  assert(
    shoulderPlan.workouts.some((d) => d.exercises.length > 0),
    "Shoulder backup plan keeps the remaining exercises.",
  );
  assert(
    starterPreview(shoulderPlan).adaptationNote?.includes("shoulder-safe"),
    "Shoulder preview surfaces adaptation note.",
  );

  // When the saved setup cannot be scheduled, the injury template still builds a week.
  const brokenShoulderSnapshot: Snapshot = {
    ...shoulderSnapshot,
    profile: { ...shoulderSnapshot.profile, trainingDays: ["FUNDAY"] },
  };
  // buildRulesFallback validates against the adapted snapshot it actually used.
  const templatePlan = await buildStarterFallback(brokenShoulderSnapshot);
  assert(
    templatePlan.workouts.some((d) => d.exercises.length > 0) &&
      templatePlan.workouts
        .flatMap((d) => d.exercises)
        .every((e) => e.region !== "shoulders"),
    "Shoulder injury template replaces a failed setup with a shoulder-free week.",
  );

  // Knee injury produces a distinct backup plan without squats or lunges.
  const kneeSnapshot: Snapshot = {
    ...snapshot,
    profile: { ...snapshot.profile, limitations: ["KNEE"] },
    candidates: [
      ...snapshot.candidates,
      {
        ...snapshot.candidates.find((c) => c.region === "legs")!,
        id: randomUUID(),
        name: "Dumbbell Romanian deadlift",
        subTarget: "hamstrings",
        primary: ["hamstrings", "glutes"],
      },
    ],
  };
  const kneePlan = await buildStarterFallback(kneeSnapshot);
  validatePlan(kneeSnapshot, kneePlan);
  assert(
    kneePlan.workouts
      .flatMap((d) => d.exercises)
      .every((e) => !/squat|lunge/i.test(e.name)),
    "Knee backup plan excludes squats and lunges.",
  );
  assert.notDeepEqual(
    shoulderPlan.workouts.map((d) => d.name),
    kneePlan.workouts.map((d) => d.name),
    "Different injuries produce distinct backup plans.",
  );

  // Custom movement notes (e.g. "bad shoulder") also produce an adapted backup plan.
  const customNotePlan = await buildStarterFallback({
    ...shoulderSnapshot,
    profile: {
      ...shoulderSnapshot.profile,
      limitations: ["NONE"],
      customLimitations: "bad shoulder",
    },
  });
  assert(
    customNotePlan.workouts
      .flatMap((d) => d.exercises)
      .every((e) => e.region !== "shoulders"),
  );

  // An AI failure for a profile with injuries falls back to the adapted backup starter plan.
  const kneeFallback = await generateStarterWithFallback(async () => {
    throw new PlannerError("MODEL_RESPONSE_INVALID", "Could not produce a validated plan.", 503);
  }, kneeSnapshot);
  assert.equal(kneeFallback.model, "starter:rules-v1");
  validatePlan(kneeSnapshot, kneeFallback);

  await assert.rejects(
    () => buildStarterFallback({ ...snapshot, candidates: [] }),
    /match|equipment/,
  );
  console.log(
    "Starter unit checks passed: male/female, provider outage, constraints, real catalogue and preview redaction.",
  );
}

async function integration() {
  const users: string[] = [];
  try {
    for (const gender of ["MALE", "FEMALE"] as const) {
      const user = await prisma.user.create({
        data: {
          email: `starter-test-${randomUUID()}@example.invalid`,
          password: "isolated-test-account",
        },
      });
      users.push(user.id);
      await prisma.onboarding.create({
        data: {
          userId: user.id,
          name: "Starter test",
          age: 30,
          gender,
          height: null,
          weight: null,
          workingToward: "BUILD_MUSCLE",
          experience: "BEGINNER",
          daysPerWeek: "DAYS_3",
          workoutDuration: "MIN_30",
          trainingLocation: "GYM",
          equipment: [
            "DUMBBELLS",
            "BARBELLS",
            "CABLE",
            "BENCH",
            "MACHINES",
            "OTHER",
          ],
          equipmentIds: Object.keys(EQUIPMENT_CATEGORIES).filter(
            (id) => id !== "bodyweight_only",
          ),
          activityLevel: "MODERATE",
          sleepDuration: "HOURS_7_TO_8",
          eatingStyle: "NO_PREFERENCE",
          limitations: ["NONE"],
          trainingSplit: "AUTO",
        },
      });
      const runs = await Promise.all([
        requestStarter(user.id, "Europe/London"),
        requestStarter(user.id, "Europe/London"),
      ]);
      assert.equal(runs[0].id, runs[1].id);
      assert.equal(
        await prisma.weeklyPlanRun.count({ where: { userId: user.id } }),
        1,
      );
      await prisma.weeklyPlanRun.update({
        where: { id: runs[0].id },
        data: {
          status: "FAILED",
          attempts: 3,
          errorCode: "PLAN_QUALITY",
          contextHash: "old-planner-rule-hash",
        },
      });
      const recovered = await requestStarter(user.id, "Europe/London");
      assert.equal(recovered.status, "QUEUED");
      assert.equal(
        recovered.attempts,
        0,
        "Updated rules recover a previously exhausted starter.",
      );
      await prisma.weeklyPlanRun.update({
        where: { id: runs[0].id },
        data: { status: "FAILED", attempts: 3, errorCode: "PLAN_QUALITY" },
      });
      const exhausted = await requestStarter(user.id, "Europe/London");
      assert.equal(exhausted.status, "FAILED");
      assert.equal(
        exhausted.canRetry,
        false,
        "Unchanged setup retains its bounded retry limit.",
      );
      assert.equal((await getStarter(user.id)).run!.canRetry, false);
      await prisma.weeklyPlanRun.update({
        where: { id: runs[0].id },
        data: { status: "QUEUED", attempts: 0, errorCode: null },
      });
      assert.equal(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .trialStartedAt,
        null,
      );
      const run = await prisma.weeklyPlanRun.findUniqueOrThrow({
        where: { id: runs[0].id },
      });
      const snapshot = run.input as unknown as Snapshot;
      const demos = await prisma.workout.findMany({where:{id:{in:snapshot.candidates.map(c=>c.id)}},select:{mediaVariants:true}});
      assert(demos.length > 0 && demos.every(row => preferredExerciseMedia(row.mediaVariants, gender.toLowerCase())), 'New plans only select exercises with the profile demonstration');
      const plan = await buildStarterFallback(run.input as unknown as Snapshot);
      await saveCompletedPlan(run.id, plan);
      let locked = await getRun(user.id, run.id);
      assert.equal(locked.status, "COMPLETED");
      const publicSamples = locked.plan!.preview!.firstWorkout!.exercises;
      assert(publicSamples.length > 0 && publicSamples.length <= 2);
      for (const sample of publicSamples) {
        assert(sample.exerciseId);
        assert(sample.exercise?.id === sample.exerciseId);
        assert(sample.exercise?.thumbnailUrl, "Preview has its real exercise poster.");
        const variants = sample.exercise?.mediaVariants as Record<string, {posterUrl: string}>;
        assert.equal(sample.exercise?.thumbnailUrl, variants[gender.toLowerCase()]?.posterUrl);
        assert(Array.isArray(sample.exercise?.instructions), "The complete public form guide is available.");
      }
      const fs = await import("node:fs/promises");
      await fs.mkdir("build/planner-review", {recursive: true});
      await fs.writeFile("build/planner-review/starter-preview-"+gender.toLowerCase()+".json", JSON.stringify(locked.plan!.preview));
      const apiBase = process.argv.find(value => value.startsWith("--api-base="))?.slice("--api-base=".length);
      if (apiBase) {
        const token = generateTokens(user.id, user.email).accessToken;
        const response = await fetch(apiBase + "/api/plans/runs/" + run.id, {headers: {Authorization: "Bearer " + token}, signal: AbortSignal.timeout(15000)});
        assert.equal(response.status, 200, "The running API returns the saved starter preview.");
        const data = await response.json() as {data: {plan: {preview: {firstWorkout: {exercises: Array<{exerciseId?: string; exercise?: {thumbnailUrl?: string}}>}}}}};
        const liveSamples = data.data.plan.preview.firstWorkout.exercises;
        assert(liveSamples.length > 0 && liveSamples.every(sample => sample.exerciseId && sample.exercise?.thumbnailUrl),
          "Running backend returned the old name-only preview. Restart the backend with current source.");
        console.log("Running API preview verified: sample identities and posters are present.");
      }
      assert.equal(locked.plan!.status, "DRAFT");
      assert.equal(locked.plan!.payload, null);
      assert.equal((await listPlans(user.id))[0]!.payload, null);
      assert.equal(
        (await getSavedPlan(user.id, locked.plan!.id)).payload,
        null,
      );
      assert.equal(
        await prisma.userWorkout.count({ where: { userId: user.id } }),
        0,
      );
      await assert.rejects(() => getRun(randomUUID(), run.id), /not found/);
      await assertStarterReady(user.id, locked.plan!.id);
      assert.equal(
        (await requestStarter(user.id, "Europe/London")).plan!.id,
        locked.plan!.id,
      );
      await assert.rejects(
        () => assertStarterReady(randomUUID(), locked.plan!.id),
        /not found/,
      );
      await prisma.onboarding.update({
        where: { userId: user.id },
        data: { weight: 71 },
      });
      await assert.rejects(
        () => assertStarterReady(user.id, locked.plan!.id),
        /changed/,
      );
      assert.equal(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .trialStartedAt,
        null,
      );
      const refreshed = await requestStarter(user.id, "Europe/London");
      assert.equal(refreshed.id, run.id);
      assert.equal(refreshed.status, "QUEUED");
      const revisedRun = await prisma.weeklyPlanRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      const revisedPlan = await buildStarterFallback(
        revisedRun.input as unknown as Snapshot,
      );
      await saveCompletedPlan(run.id, revisedPlan);
      locked = await getRun(user.id, run.id);
      await assertStarterReady(user.id, locked.plan!.id);
      await assert.rejects(() => startTrial(user.id), /Choose a membership/);
      // An already-granted legacy entitlement exercises plan activation without
      // making a store purchase. Store verification has its own integration suite.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          trialStartedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 14 * 86400000),
        },
      });
      const access = await startTrial(user.id);
      assert.equal(access.state, "trial");
      const trialStart = access.trialStartedAt;
      const trialEnd = access.trialEndsAt;
      // Preferences can change while checkout is open. A verified entitlement
      // must not prevent recovery of the still-unpublished starter draft.
      const beforeCheckoutRefresh = locked.plan!.id;
      await prisma.onboarding.update({
        where: { userId: user.id },
        data: { weight: 72 },
      });
      await assert.rejects(
        () => assertStarterReady(user.id, beforeCheckoutRefresh),
        /changed/,
      );
      const afterCheckout = await requestStarter(user.id, "Europe/London");
      assert.equal(afterCheckout.id, run.id);
      assert.equal(afterCheckout.status, "QUEUED");
      const checkoutRun = await prisma.weeklyPlanRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      await saveCompletedPlan(
        run.id,
        await buildStarterFallback(checkoutRun.input as unknown as Snapshot),
      );
      locked = await getRun(user.id, run.id);
      assert.notEqual(locked.plan!.id, beforeCheckoutRefresh);
      const preservedAccess = await startTrial(user.id);
      assert.deepEqual(preservedAccess.trialStartedAt, trialStart);
      assert.deepEqual(preservedAccess.trialEndsAt, trialEnd);
      assert.equal(
        await prisma.weeklyPlanRun.count({ where: { userId: user.id } }),
        1,
      );
      assert.equal(
        await prisma.userWorkout.count({ where: { userId: user.id } }),
        0,
      );
      await assertStarterReady(user.id, locked.plan!.id);
      await assertFreshPlan(user.id, locked.plan!.id);
      await activatePlan(user.id, locked.plan!.id);
      assert.equal((await getRun(user.id, run.id)).plan!.status, "ACTIVE");
      assert(
        (await prisma.userWorkout.count({ where: { userId: user.id } })) > 0,
      );
      await prisma.onboarding.update({
        where: { userId: user.id },
        data: { weight: 73 },
      });
      const repeated = await requestStarter(user.id, "Europe/London");
      assert.equal(repeated.id, run.id);
      assert.equal(repeated.plan!.id, locked.plan!.id);
      assert.equal(repeated.plan!.status, "ACTIVE");
      assert.deepEqual((await startTrial(user.id)).trialStartedAt, trialStart);
      assert((await getStarter(user.id)).hasAccess);
    }
    console.log(
      "Starter integration checks passed: concurrent allowance, private preview, no premature publication, trial and activation.",
    );
  } finally {
    for (const id of users) await prisma.user.delete({ where: { id } });
  }
}

unit()
  .then(() =>
    process.argv.includes("--integration") ? integration() : undefined,
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
