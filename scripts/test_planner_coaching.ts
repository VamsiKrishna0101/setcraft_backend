import {prescribedWorkoutMinutes} from '../utils/workout_duration';
import "dotenv/config";
import fs from 'node:fs';
import path from 'node:path';
import {createOnboardingSchema} from '../modules/onboarding/onboarding_types';
import {MUSCLE_IDS} from '../modules/heatmap/training_map_engine';
import {mondayOf, localMidnight, validateSelectedSchedule} from '../graphworkflow/common/calendar_schedule';
import {shiftPendingWorkouts} from '../modules/workout/session/schedule_engine';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Candidate,
  Snapshot,
  REGIONS,
  RegionalResult,
  PlannerError,
  WeeklyPlan,
  requireCompletedPlan,
} from "../graphworkflow/common/types";
import {
  exerciseEligible,
  movementOf,
  rankedCandidates,
  programmeFor,
  experiencePrompt,
} from "../graphworkflow/common/coaching";
import {
  enteredMeasurements,
  measurementContext,
  plannerSnapshot,
  textOnlyPlannerInput,
} from "../graphworkflow/common/measurements";
import { fallbackChoices } from "../graphworkflow/common/fallback_choices";
import { sessionQualityIssues } from "../graphworkflow/common/session_quality";
import { exerciseRules, nextLoad } from "../graphworkflow/common/loading";
import { buildRegionInput } from "../graphworkflow/common/region_input";
import {
  trainingSchedule,
  hashContext,
} from "../graphworkflow/nodes/prepare_node";
import {
  buildRegionalResult,
  assembleNode,
  validatePlan,
} from "../graphworkflow/nodes/validation_node";
import { weekReviewNode } from "../graphworkflow/nodes/week_review_node";
import {
  buildStarterFallback,
  generateWeeklyWithFallback,
} from "../graphworkflow/starter_fallback";
import { buildWeeklyGraph } from "../graphworkflow/graph";
import { PlannerState } from "../graphworkflow/common/state";
import {
  StructuredModel,
  createStructuredModel,
  limitModelConcurrency,
} from "../graphworkflow/common/model";

function candidate(
  region: Candidate["region"],
  name: string,
  equipment = "dumbbell",
  primary?: string[],
): Candidate {
  return {
    id: randomUUID(),
    name,
    region,
    equipment,
    primary: primary ?? [region],
    secondary:
      region === "chest"
        ? ["triceps", "shoulders"]
        : region === "back"
          ? ["biceps"]
          : [],
    pattern:
      region === "chest"
        ? "push"
        : region === "back"
          ? "pull"
          : region === "legs"
            ? /deadlift|bridge/i.test(name)
              ? "hinge"
              : "squat"
            : region,
    compound: ["chest", "back", "legs"].includes(region),
    bodyweight: equipment === "body weight",
    requiresBench: false,
    subTarget: primary?.[0] ?? region,
    difficulty: "beginner",
  };
}

function fixture(): Snapshot {
  return {
    version: 1,
    userId: randomUUID(),
    weekStart: "2026-10-26",
    cutoff: "2026-10-19",
    historyStart: "2026-09-29",
    timezone: "Europe/Amsterdam",
    synthetic: false,
    profile: {
      age: 30,
      gender: "FEMALE",
      height: 170,
      weight: 70,
      targetWeight: 70,
      goal: "BUILD_MUSCLE",
      experience: "BEGINNER",
      daysPerWeek: 3,
      minutes: 45,
      trainingDays: [],
      trainingSplit: "AUTO",
      equipment: ["DUMBBELLS", "MACHINES", "CABLE"],
      equipmentIds: [
        "dumbbells",
        "chest press",
        "lat pulldown",
        "seated row",
        "leg press",
      ],
      location: "GYM",
      limitations: ["NONE"],
      customLimitations: null,
      focusMuscles: [],
      language: "en",
      eatingStyle: "NO_PREFERENCE",
      activityLevel: "MODERATE",
      allergies: [],
      dislikes: [],
      countryCode: "NL",
      budgetAmount: null,
      budgetCurrency: null,
    },
    candidates: [
      candidate("chest", "Dumbbell floor press"),
      candidate("chest", "Machine chest press", "leverage machine"),
      candidate("chest", "Clock push-up", "body weight"),
      candidate("chest", "Handstand push-up", "body weight"),
      candidate("back", "Dumbbell bent over row", "dumbbell", ["upper_back"]),
      candidate("back", "Cable lat pulldown", "cable", ["lats"]),
      candidate("legs", "Dumbbell goblet squat", "dumbbell", ["quads"]),
      candidate("legs", "Dumbbell Romanian deadlift", "dumbbell", [
        "hamstrings",
        "glutes",
      ]),
      candidate("shoulders", "Dumbbell lateral raise"),
      candidate("biceps", "Dumbbell curl"),
      candidate("triceps", "Dumbbell triceps extension"),
      candidate("core", "Dumbbell crunch"),
    ],
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

async function baseline(snapshot: Snapshot) {
  const schedule = trainingSchedule(snapshot);
  const regions = Object.fromEntries(
    REGIONS.map((region) => [
      region,
      buildRegionalResult(
        snapshot,
        schedule,
        region,
        fallbackChoices(snapshot, schedule, region),
      ),
    ]),
  ) as Record<Candidate["region"], RegionalResult>;
  const inputs = Object.fromEntries(
    REGIONS.map((region) => [
      region,
      buildRegionInput(snapshot, schedule, region),
    ]),
  );
  const state = {
    snapshot,
    schedule,
    regions,
    inputs,
  } as unknown as PlannerState;
  return { ...state, ...(await assembleNode(state, async () => {})) };
}

async function main() {
  assert(createOnboardingSchema.shape.focusMuscles.safeParse([...MUSCLE_IDS]).success);
  assert(createOnboardingSchema.shape.focusMuscles.safeParse([]).success);
  assert(!createOnboardingSchema.shape.focusMuscles.safeParse(['chest','chest']).success);
  const allFocus = fixture();
  allFocus.profile.focusMuscles = [...MUSCLE_IDS];
  const allFocusPlan = await baseline(allFocus);
  validatePlan(allFocus, allFocusPlan.plan);
  const { recommendedSplit, focusedGroups } = await import('../graphworkflow/common/training_style');
  const scheduleCases = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../mobile/test/fixtures/training_styles.json'),'utf8'));
  for(const [days,groups] of Object.entries(scheduleCases)) assert.deepEqual(focusedGroups(Number(days)),groups);
  const { nutritionTargets } = await import('../utils/nutrition_targets');
  const setup = fixture();
  setup.profile.experience = 'INTERMEDIATE';
  setup.profile.goal = 'GET_STRONGER';
  assert.equal(recommendedSplit(setup.profile, 6), 'PUSH_PULL_LEGS');
  assert.deepEqual(exerciseRules(setup, setup.candidates[0]!, false).minReps, 5);
  assert.equal(exerciseRules(setup, setup.candidates[0]!, false).recommendedSets, 3);
  setup.profile.experience = 'BEGINNER';
  setup.profile.trainingSplit = 'MUSCLE_FOCUSED';
  assert.deepEqual(trainingSchedule(setup)[0]!.regions, ['chest','shoulders','triceps']);
  setup.profile.trainingSplit = 'CUSTOM';
  setup.profile.trainingDays = ['MONDAY', 'THURSDAY'];
  setup.profile.customTrainingSplit = {MONDAY:['chest','triceps'],THURSDAY:['back','legs','biceps','core']};
  assert.deepEqual(trainingSchedule(setup)[0]!.regions, ['chest','triceps']);
  const prepared = await baseline(fixture());
  const parsed = (await import('../graphworkflow/common/types')).planSchema.parse(prepared.plan);
  validatePlan(prepared.snapshot, parsed);
  for (const day of parsed.workouts) {
    if (day.restDay) assert.equal(day.warmup, undefined);
    else {
      assert.equal(day.warmup?.durationMinutes, 5);
      assert.equal(day.warmup?.steps.reduce((sum,s)=>sum+s.seconds,0), 300);
      assert.equal(day.warmup?.steps[1]?.exerciseId, day.exercises[0]?.exerciseId);
      assert.equal(day.warmup?.steps[1]?.weightKg, null);
    }
  }
  const tampered = structuredClone(parsed);
  tampered.workouts.find(d=>!d.restDay)!.warmup!.steps[1]!.weightKg = 999;
  assert.throws(()=>validatePlan(prepared.snapshot,tampered), /Warm-up/);
  const targetProfile = {weight:70,height:170,age:30,gender:'FEMALE',activityLevel:'MODERATE',workingToward:'LOSE_BODY_FAT'};
  const loss = nutritionTargets(targetProfile);
  const maintenance = nutritionTargets({...targetProfile,workingToward:'GET_STRONGER'});
  assert(loss.targetCalories < maintenance.targetCalories);
  assert(loss.targetCalories >= 1400 && loss.targetCarbs >= 0);
  assert.deepEqual(loss,nutritionTargets({...targetProfile,workingToward:'LOSE_WEIGHT'}));
  assert(nutritionTargets({...targetProfile,weight:110}).targetCalories > loss.targetCalories);
  for (const dates of [['2026-10-29'], ['2026-10-28', '2026-10-30'], ['2026-10-28', '2026-10-30', '2026-11-01']]) {
    const partial = fixture();
    partial.selectedSchedule = {startDate: '2026-10-28', trainingDates: dates};
    partial.profile.trainingSplit = 'PUSH_PULL_LEGS';
    const generated = await baseline(partial);
    const checked = validatePlan(partial, generated.plan);
    assert.deepEqual(checked.workouts.filter(day => !day.restDay).map(day => day.date), dates);
    assert(checked.workouts.filter(day => day.date < '2026-10-28').every(day => day.restDay && !day.exercises.length));
  }
  assert.equal(mondayOf('2027-01-03'), '2026-12-28');
  assert.equal(localMidnight('2026-10-26', 'Europe/Amsterdam').toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(localMidnight('2026-03-30', 'Europe/Amsterdam').toISOString(), '2026-03-29T22:00:00.000Z');
  assert.throws(() => validateSelectedSchedule('2026-10-26', '2026-10-28', {startDate: '2026-10-27', trainingDates: ['2026-10-29']}));
  assert.throws(() => validateSelectedSchedule('2026-10-26', '2026-10-28', {startDate: '2026-10-28', trainingDates: ['2026-11-02']}));
  const pending = [{id: 'a', name: 'Chest', date: '2026-12-30'}, {id: 'b', name: 'Back', date: '2026-12-31'}, {id: 'c', name: 'Legs', date: '2027-01-01'}];
  assert.deepEqual(shiftPendingWorkouts(pending, ['2026-12-31','2027-01-01','2027-01-02']).map(row => row.toDate), ['2026-12-31','2027-01-01','2027-01-02']);
  assert.deepEqual(shiftPendingWorkouts(pending, ['2026-12-31']).map(row => row.toDate), ['2026-12-31',null,null]);
  assert.equal(shiftPendingWorkouts(pending, [], true).length, 1);
  const spaced = [{id:'a',name:'Chest',date:'2026-10-28'}, {id:'b',name:'Back',date:'2026-10-30'}];
  assert.deepEqual(shiftPendingWorkouts(spaced, ['2026-10-29','2026-10-30','2026-10-31']).map(row => row.toDate), ['2026-10-29','2026-10-31']);
  console.log('Training setup and calendar checks passed: selected dates, partial weeks, daylight saving, year boundaries, ordered moves, rest spacing and explicit skips.');
  const lowVolume = fixture();
  const backCandidate = lowVolume.candidates.find(c=>c.region==='back')!;
  lowVolume.sets=[{id:randomUUID(),exerciseId:backCandidate.id,date:lowVolume.cutoff,set:1,
    reps:8,weight:10,rpe:9,synthetic:false,primaryMuscles:backCandidate.primary}];
  lowVolume.wellness=[{date:lowVolume.cutoff,sleepMinutes:300,energy:2,rested:2,soreness:4,source:'manual'}];
  const reduced = await baseline(lowVolume);
  validatePlan(lowVolume,reduced.plan);
  let checks = 0;
  // Matrix covers first-time beginners, intermediates and experienced users at
  // home/in a gym, both genders, and sessions that cannot fit six movements.
  for (const experience of ["BEGINNER", "INTERMEDIATE", "ADVANCED"]) {
    for (const location of ["HOME", "GYM"]) {
      for (const gender of ["MALE", "FEMALE"]) {
        for (const minutes of [20, 30, 45, 60]) {
          const snapshot = fixture();
          Object.assign(snapshot.profile, {
            experience,
            location,
            gender,
            minutes,
          });
          if (location === "HOME") {
            snapshot.profile.equipmentIds = ["dumbbells"];
            snapshot.profile.equipment = ["DUMBBELLS"];
          }
          const state = await baseline(snapshot);
          assert.deepEqual(
            sessionQualityIssues(snapshot, state.plan, state.schedule),
            [],
          );
          validatePlan(snapshot, state.plan);
          for (const day of state.plan.workouts.filter((d) => !d.restDay)) {
            const assigned = state.schedule.find(d=>d.date===day.date)!;
            assert(day.exercises.length >= assigned.regions.length);
            assert(day.estimatedMinutes <= minutes);
            assert.equal(day.estimatedMinutes, prescribedWorkoutMinutes(day.exercises.map(e => ({targetSets:e.sets,targetReps:`${e.repsMin}-${e.repsMax}`,restSeconds:e.restSeconds})), day.warmup?.durationMinutes ?? 0), 'Published prescriptions preserve the preview estimate within the selected time budget');
            assert(
              day.exercises.every(
                (e) => e.weightKg == null || e.weightKg === 0,
              ),
            );
            assert(
              day.exercises.every((e) => !/clock|handstand/i.test(e.name)),
            );
          }
          const reverse = structuredClone(snapshot);
          reverse.candidates.reverse();
          assert.deepEqual(
            (await baseline(reverse)).plan.workouts,
            state.plan.workouts,
            "Database ordering cannot change the selected week.",
          );
          checks++;
        }
      }
    }
  }
  for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    for (const minutes of [20, 30, 45, 60]) {
      for (const trainingSplit of [
        "AUTO",
        "FULL_BODY",
        "UPPER_LOWER",
        "MUSCLE_FOCUSED",
        "PUSH_PULL_LEGS",
      ] as const) {
        if (daysPerWeek < 3 && trainingSplit === "PUSH_PULL_LEGS") continue;
        const frequency = fixture();
        Object.assign(frequency.profile, {
          daysPerWeek,
          minutes,
          trainingSplit,
        });
        if (
          daysPerWeek === 2 &&
          minutes === 20 &&
          trainingSplit === "MUSCLE_FOCUSED"
        ) {
          assert.throws(() => trainingSchedule(frequency), /full body/);
          continue;
        }
        const planned = await baseline(frequency);
        validatePlan(frequency, planned.plan);
        assert.equal(
          planned.plan.workouts.filter((d) => !d.restDay).length,
          daysPerWeek,
        );
        checks++;
      }
    }
  }
  for (const gender of ["MALE", "FEMALE"]) {
    for (const minutes of [20, 45]) {
      const home = fixture();
      Object.assign(home.profile, {
        gender,
        minutes,
        location: "HOME",
        equipmentIds: ["bodyweight_only"],
        equipment: ["OTHER"],
      });
      home.candidates = [
        candidate("chest", "Wall push-up", "body weight"),
        candidate("legs", "Bodyweight squat", "body weight", ["quads"]),
        candidate("legs", "Glute bridge", "body weight", [
          "glutes",
          "hamstrings",
        ]),
        candidate("core", "Crunch", "body weight"),
      ];
      const planned = await baseline(home);
      validatePlan(home, planned.plan);
      assert(
        planned.plan.workouts
          .filter((d) => !d.restDay)
          .every((d) => d.exercises.length >= 3),
      );
      assert(planned.plan.warnings.some((w) => w.includes("pulling exercise")));
      assert(
        planned.plan.workouts
          .flatMap((d) => d.exercises)
          .every((e) => e.weightKg === 0),
      );
      checks++;
    }
  }
  const snapshot = fixture();
  // These checks deliberately compare allocation within a full-body day.
  snapshot.profile.trainingSplit = 'FULL_BODY';
  const male = structuredClone(snapshot);
  male.profile.gender = "MALE";
  assert.deepEqual(
    (await baseline(male)).plan.workouts,
    (await baseline(snapshot)).plan.workouts,
  );
  assert.equal(
    rankedCandidates(snapshot, "chest")[0]!.name,
    "Machine chest press",
  );
  assert(
    !exerciseEligible(
      snapshot,
      snapshot.candidates.find((c) => /handstand/i.test(c.name))!,
    ),
  );

  const glutes = structuredClone(snapshot);
  glutes.profile.focusMuscles = ["glutes"];
  assert(
    trainingSchedule(glutes)[0]!.minutesByRegion!.legs! >
      trainingSchedule(snapshot)[0]!.minutesByRegion!.legs!,
  );
  const lats = structuredClone(snapshot);
  lats.profile.focusMuscles = ["lats"];
  assert(
    trainingSchedule(lats)[0]!.minutesByRegion!.back! >
      trainingSchedule(snapshot)[0]!.minutesByRegion!.back!,
  );

  const weighted = snapshot.candidates[0]!;
  const history = ["2026-10-13", "2026-10-16"].flatMap((date) =>
    [1, 2].map((set) => ({
      id: randomUUID(),
      exerciseId: weighted.id,
      date,
      set,
      reps: 10,
      weight: 20,
      rpe: 6,
      synthetic: false,
      plannedRepsMin: 10,
      plannedRepsMax: 10,
      plannedSets: 2,
    })),
  );
  snapshot.sets = history;
  const rules = exerciseRules(snapshot, weighted, false);
  assert.equal(
    rules.recommendedSets,
    3,
    "Adapted beginners can build beyond an introductory two sets.",
  );
  assert.equal(rules.recommendedReps, 11);
  assert.equal(
    nextLoad({
      logs: history,
      candidate: weighted,
      profile: snapshot.profile,
      reducedRecovery: false,
    }).suggestedKg,
    20,
  );
  assert.equal(
    nextLoad({
      logs: history.map((s) => ({ ...s, reps: 12, plannedRepsMax: 12 })),
      candidate: weighted,
      profile: snapshot.profile,
      reducedRecovery: false,
    }).suggestedKg,
    21,
  );
  assert.equal(
    nextLoad({
      logs: [],
      candidate: weighted,
      profile: snapshot.profile,
      reducedRecovery: false,
    }).suggestedKg,
    null,
  );
  assert.equal(
    exerciseRules(
      { ...snapshot, sets: history.map((s) => ({ ...s, rpe: null })) },
      weighted,
      false,
    ).recommendedSets,
    2,
  );
  assert.equal(exerciseRules(snapshot, weighted, true).recommendedSets, 2);

  const privateSnapshot = fixture();
  privateSnapshot.freshPhotos = [
    {
      view: "front",
      mimeType: "image/jpeg",
      base64Data: "PRIVATE_PHOTO",
      recordedDate: snapshot.cutoff,
    },
  ];
  privateSnapshot.measurements = [
    {
      id: "photo",
      date: "2026-10-19",
      source: "photo_review",
      metrics: { chestCm: { value: 110, source: "photo_estimate" } },
      summary: "PRIVATE_PHOTO_GUIDANCE",
      guidance: [{ region: "chest", observation: "PRIVATE_PHOTO_GUIDANCE" }],
    },
    {
      id: "weight",
      date: "2026-10-19",
      source: "entered",
      metrics: { weightKg: { value: 70, source: "scale" } },
    },
    {
      id: "new-tape",
      date: "2026-10-15",
      source: "entered",
      metrics: { chestCm: { value: 100, source: "tape" } },
    },
    {
      id: "old-tape",
      date: "2026-10-01",
      source: "entered",
      metrics: { chestCm: { value: 99, source: "tape" } },
    },
  ];
  assert.equal(enteredMeasurements(privateSnapshot.measurements).length, 3);
  const context = measurementContext(privateSnapshot, ["chestCm"])!;
  assert.deepEqual(context.metrics.chestCm, {
    value: 100,
    source: "tape",
    recordedDate: "2026-10-15",
    evidenceId: "new-tape",
    change: 1,
    since: "2026-10-01",
    previousEvidenceId: "old-tape",
  });
  const clean = plannerSnapshot(privateSnapshot);
  assert(!JSON.stringify(clean).includes("PRIVATE_PHOTO"));
  assert.equal(hashContext(privateSnapshot), hashContext(clean));
  assert(
    !JSON.stringify(
      textOnlyPlannerInput({
        nested: { photos: ["PRIVATE_PHOTO"], freshPhotos: ["PRIVATE_PHOTO"] },
      }),
    ).includes("PRIVATE_PHOTO"),
  );

  const previous = await baseline(snapshot);
  snapshot.programmeMemory = {
    planId: randomUUID(),
    weekStart: "2026-10-19",
    programme: previous.plan.programme,
    exerciseIds: [weighted.id],
  };
  assert.equal(
    programmeFor(snapshot).startedOn,
    previous.plan.programme!.startedOn,
  );
  assert(
    rankedCandidates(snapshot, "chest").findIndex(
      (c) => c.id === weighted.id,
    ) === 0,
  );
  assert(experiencePrompt(snapshot).includes("BEGINNER POLICY"));

  const reviewFixture = fixture();
  reviewFixture.profile.trainingSplit = 'FULL_BODY';
  const state = await baseline(reviewFixture);
  // Deliberately remove all hinges without changing the knee-dominant exercise.
  const knee = state.snapshot.candidates.find(
    (c) => movementOf(c) === "knee_dominant",
  )!;
  const brokenRegions = {
    ...state.regions,
    legs: buildRegionalResult(state.snapshot, state.schedule, "legs", {
      days: state.schedule
        .filter((d) => d.regions.includes("legs"))
        .map((d) => ({
          date: d.date,
          exercises: [
            {
              exerciseId: knee.id,
              sets: 2,
              repsMin: 8,
              repsMax: 8,
              weightKg: null,
              targetRpe: 6,
              restSeconds: 90,
              reason: "Test",
              progression: "Test",
            },
          ],
        })),
    }),
  };
  const broken = {
    ...state,
    regions: brokenRegions,
    ...(await assembleNode(
      { ...state, regions: brokenRegions },
      async () => {},
    )),
  };
  assert(
    sessionQualityIssues(broken.snapshot, broken.plan, broken.schedule).some(
      (i) => i.includes("hip_dominant"),
    ),
  );
  let reviewed = false;
  const reviewer: StructuredModel = async (
    schema,
    _prompt,
    input,
    validate,
  ) => {
    reviewed = true;
    assert((input as { qualityIssues: string[] }).qualityIssues.length > 0);
    const value = schema.parse({
      repairs: [
        {
          region: "legs",
          choice: fallbackChoices(broken.snapshot, broken.schedule, "legs"),
        },
      ],
    });
    validate(value);
    return value;
  };
  const repaired = await weekReviewNode(broken, reviewer, async () => {});
  assert(reviewed);
  validatePlan(broken.snapshot, repaired.plan);
  const unavailable: StructuredModel = async () => {
    throw new PlannerError("MODEL_UNAVAILABLE", "Test outage");
  };
  const repairedOffline = await weekReviewNode(
    broken,
    unavailable,
    async () => {},
  );
  validatePlan(broken.snapshot, repairedOffline.plan);
  const invalid: StructuredModel = async (
    schema,
    _prompt,
    _input,
    validate,
  ) => {
    const value = schema.parse({ repairs: [] });
    validate(value);
    return value;
  };
  await assert.rejects(
    () => weekReviewNode(broken, invalid, async () => {}),
    /hip_dominant/,
  );
  const starter = await buildStarterFallback({
    ...fixture(),
    onboardingStarter: true,
  });
  assert(
    !starter.workouts
      .flatMap((d) => d.exercises)
      .some((e) => /clock|handstand/i.test(e.name)),
  );
  const weeklyFallback = await generateWeeklyWithFallback(async () => {
    throw new PlannerError("MODEL_UNAVAILABLE", "Test outage");
  }, snapshot);
  validatePlan(snapshot, weeklyFallback);
  assert.equal(weeklyFallback.model, "weekly:rules-v2");
  assert(
    weeklyFallback.workouts
      .flatMap((d) => d.exercises)
      .some((e) => e.exerciseId === weighted.id && e.weightKg === 20),
  );
  await assert.rejects(
    () =>
      generateWeeklyWithFallback(async () => {
        throw new PlannerError("STALE_PLAN", "Test stale input");
      }, snapshot),
    /stale input/,
  );

  // End-to-end graph with a validating fixture model: no provider or database writes.
  const graphSnapshot = privateSnapshot;
  const calls: unknown[] = [];
  const model: StructuredModel = async (schema, _prompt, input, validate) => {
    calls.push(input);
    const region = (input as { region?: Candidate["region"] }).region;
    const value = schema.parse(
      region
        ? fallbackChoices(
            graphSnapshot,
            trainingSchedule(graphSnapshot),
            region,
          )
        : { repairs: [] },
    );
    validate(value);
    return value;
  };
  const result = await buildWeeklyGraph({ model }).invoke({
    snapshot: graphSnapshot,
    regions: {},
  });
  validatePlan(plannerSnapshot(graphSnapshot), result.plan);
  for (const providerConcurrency of [1, 3]) {
    let active = 0,
      peak = 0;
    const counted: StructuredModel = async (
      schema,
      prompt,
      input,
      validate,
    ) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await model(schema, prompt, input, validate);
      } finally {
        active--;
      }
    };
    const checked = await buildWeeklyGraph({
      model: limitModelConcurrency(counted, providerConcurrency),
    }).invoke({ snapshot: graphSnapshot, regions: {} }, { maxConcurrency: 3 });
    validatePlan(plannerSnapshot(graphSnapshot), requireCompletedPlan(checked));
    assert(
      peak > 0 && peak <= providerConcurrency,
      "Provider concurrency must be bounded without stopping graph completion.",
    );
  }
  assert.throws(() => requireCompletedPlan({}), /did not finish/);
  const incompleteFallback = await generateWeeklyWithFallback(
    async () => requireCompletedPlan({}),
    fixture(),
  );
  assert.equal(incompleteFallback.model, "weekly:rules-v2");
  assert(!JSON.stringify(calls).includes("PRIVATE_PHOTO"));
  console.log(
    `Planner coaching checks passed: ${checks} profile scenarios plus progression, gender parity, privacy, continuity, quality repair, provider outage and full graph.`,
  );
  if (process.argv.includes("--live") || process.argv.includes("--live-home")) {
    // Explicit opt-in: fictional profiles, no account reads or database writes.
    for (const location of process.argv.includes("--live-home")
      ? ["HOME"]
      : ["GYM", "HOME"]) {
      const live = fixture();
      live.profile.location = location;
      if (location === "HOME") {
        live.profile.equipment = ["DUMBBELLS"];
        live.profile.equipmentIds = ["dumbbells"];
      }
      const generated = await buildWeeklyGraph({
        model: limitModelConcurrency(
          createStructuredModel(45000, 3, (failure) =>
            console.warn("Fictional-profile model diagnostic", failure),
          ),
          1,
        ),
      }).invoke({ snapshot: live, regions: {} }, { maxConcurrency: 3 });
      assert(
        generated.plan,
        `Live graph did not finish: keys=${Object.keys(generated).join(",")}; regions=${Object.keys(generated.regions ?? {}).join(",")}`,
      );
      validatePlan(live, generated.plan);
      console.log(
        `Live ${location} model check passed (${generated.plan.model}): ` +
          generated.plan.workouts
            .filter((d) => !d.restDay)
            .map(
              (d) =>
                `${d.estimatedMinutes} min / ${d.exercises.length} exercises`,
            )
            .join(", "),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
