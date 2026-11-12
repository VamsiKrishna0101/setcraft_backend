import { PlannerState, StageReporter } from "./common/state";
import { Snapshot, REGIONS, Region, PlannerError, WeeklyPlan } from "./common/types";
import { prepareNode, trainingDates } from "./nodes/prepare_node";
import { weekday } from "../modules/workout/session/session_types";
import { fallbackChoices } from "./common/fallback_choices";
import { activeLimitations } from "./common/constraints";
import { rankedCandidates } from "./common/coaching";
import {
  assembleNode,
  buildRegionalResult,
  validatePlan,
} from "./nodes/validation_node";

export function mayUseStarterFallback(error: unknown) {
  if (
    error instanceof PlannerError &&
    [
      "STALE_PLAN",
      "WORKFLOW_UPDATED",
      "PROFILE_REQUIRED",
      "ADULT_PROFILE_REQUIRED",
      "AI_CONSENT_REQUIRED",
    ].includes(error.code)
  ) {
    return false;
  }
  return true;
}

function injurySummaryNote(limitations: Set<string>, customNotes: string | null) {
  const labels: string[] = [];
  if (limitations.has("SHOULDER")) labels.push("shoulder-safe (excludes shoulder & overhead exercises)");
  if (limitations.has("KNEE")) labels.push("knee-friendly (replaces squats & lunges)");
  if (limitations.has("BACK")) labels.push("back-friendly (avoids heavy spinal loading)");
  if (limitations.has("WRIST")) labels.push("wrist-friendly (neutral grips & supported moves)");
  if (limitations.has("HIP")) labels.push("hip-friendly (avoids deep hip flexion)");
  if (labels.length) return `Adapted for your movement needs: ${labels.join("; ")}.`;
  if (customNotes?.trim()) return "Adapted around your saved movement notes.";
  return null;
}

function adaptedDayName(name: string, limitations: Set<string>, hasLegs: boolean) {
  if (name === "Rest day") return name;
  if (limitations.has("SHOULDER") && /full body|upper|chest|push/i.test(name)) {
    return name === "Full body" ? "Shoulder-safe full body" : `${name} (shoulder-safe)`;
  }
  if (limitations.has("KNEE") && hasLegs) {
    return name === "Full body" ? "Knee-friendly full body" : `${name} (knee-friendly)`;
  }
  if (limitations.has("BACK")) {
    return name === "Full body" ? "Back-friendly full body" : `${name} (back-friendly)`;
  }
  if (limitations.has("WRIST")) {
    return `${name} (wrist-friendly)`;
  }
  if (limitations.has("HIP") && hasLegs) {
    return `${name} (hip-friendly)`;
  }
  return name;
}

// Week layouts that move work away from an injured area instead of failing.
// Each day still passes through the per-exercise limitation filter.
const INJURY_TEMPLATES: Array<[string, Region[][]]> = [
  ["SHOULDER", [["legs", "core"], ["back", "biceps"], ["legs", "triceps", "core"]]],
  ["BACK", [["chest", "shoulders", "triceps"], ["legs", "core"], ["back", "biceps"]]],
  ["KNEE", [["chest", "back", "shoulders"], ["legs", "core"], ["back", "biceps", "triceps"]]],
  ["HIP", [["chest", "back", "shoulders"], ["biceps", "triceps", "core"], ["back", "legs"]]],
  ["WRIST", [["legs", "core"], ["chest", "back"], ["legs", "shoulders", "core"]]],
];

function injuryTemplateSnapshot(snapshot: Snapshot): Snapshot | null {
  const limitations = activeLimitations(snapshot.profile);
  const template = INJURY_TEMPLATES.find(([key]) => limitations.has(key))?.[1];
  if (!template) return null;
  const profile = {
    ...snapshot.profile,
    daysPerWeek: Math.min(Math.max(snapshot.profile.daysPerWeek || 3, 2), 5),
    minutes: Math.max(snapshot.profile.minutes || 30, 20),
  };
  let dates: string[];
  try {
    dates = trainingDates({ ...snapshot, profile });
  } catch {
    dates = trainingDates({ ...snapshot, profile: { ...profile, trainingDays: [] } });
    profile.trainingDays = [];
  }
  const customTrainingSplit: Record<string, Region[]> = {};
  dates.forEach((date, index) => {
    customTrainingSplit[weekday(date)] = template[index % template.length]!;
  });
  return {
    ...snapshot,
    profile: { ...profile, trainingSplit: "CUSTOM", customTrainingSplit },
  };
}

function conservativeSnapshot(snapshot: Snapshot, minimal = false): Snapshot {
  return {
    ...snapshot,
    profile: {
      ...snapshot.profile,
      trainingSplit: "FULL_BODY",
      customTrainingSplit: undefined,
      trainingDays: [],
      daysPerWeek: minimal
        ? 3
        : Math.min(Math.max(snapshot.profile.daysPerWeek || 3, 2), 4),
      minutes: minimal ? 45 : Math.max(snapshot.profile.minutes || 30, 20),
      ...(minimal ? { experience: "BEGINNER" } : {}),
    },
  };
}

/**
 * A conservative catalogue-based prescription, never fabricated workout history.
 * Tries progressively simpler layouts so onboarding always gets a starter week
 * whenever any eligible exercise exists for the person's equipment and injuries.
 */
export async function buildStarterFallback(
  snapshot: Snapshot,
  report: StageReporter = async () => {},
): Promise<WeeklyPlan> {
  const starterSnapshot: Snapshot = { ...snapshot, onboardingStarter: true };
  let lastError: unknown;
  try {
    return await buildRulesFallback(starterSnapshot, report, true);
  } catch (error) {
    if (!mayUseStarterFallback(error)) throw error;
    lastError = error;
  }
  const hasAnyExercise = REGIONS.some(
    (region) => rankedCandidates(starterSnapshot, region).length > 0,
  );
  if (!hasAnyExercise) throw lastError;
  const attempts = [
    () => injuryTemplateSnapshot(starterSnapshot),
    () => conservativeSnapshot(starterSnapshot),
    () => conservativeSnapshot(starterSnapshot, true),
  ];
  for (const attempt of attempts) {
    let candidate: Snapshot | null;
    try {
      candidate = attempt();
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!candidate) continue;
    try {
      return await buildRulesFallback(candidate, report, true);
    } catch (error) {
      if (!mayUseStarterFallback(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function buildRulesFallback(
  snapshot: Snapshot,
  report: StageReporter = async () => {},
  starter = false,
): Promise<WeeklyPlan> {
  if (
    snapshot.profile.age < 18 ||
    snapshot.synthetic ||
    (!starter &&
      (snapshot.profile.limitations.some((value) => value !== "NONE") ||
        snapshot.profile.customLimitations?.trim()))
  ) {
    throw new PlannerError(
      "STARTER_REVIEW_REQUIRED",
      "Your profile needs reviewed exercise selection. Please review your movement notes.",
      422,
    );
  }
  const base = { snapshot, regions: {} } as PlannerState;
  const prepared = await prepareNode(base, report);
  const state = { ...base, ...prepared } as PlannerState;
  for (const region of REGIONS) {
    state.regions[region] = buildRegionalResult(
      state.snapshot,
      state.schedule,
      region,
      fallbackChoices(state.snapshot, state.schedule, region),
    );
    await report("specialists", region);
  }
  const { plan } = await assembleNode(state, report);
  await report("workout_prescriptions", "workouts");
  const candidateById = new Map(
    snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  for (const exercise of plan.workouts.flatMap((day) => day.exercises)) {
    const candidate = candidateById.get(exercise.exerciseId);
    exercise.displayName = candidate?.displayName;
    exercise.region = candidate?.region;
    if (starter && exercise.weightBasis !== "bodyweight") {
      exercise.weightKg = null;
      exercise.weightBasis = "establish_starting_load";
      for (const set of exercise.setPrescriptions) set.weightKg = null;
    }
  }
  const limitations = activeLimitations(snapshot.profile);
  const injuryNote = injurySummaryNote(limitations, snapshot.profile.customLimitations);
  if (injuryNote) {
    for (const day of plan.workouts) {
      const hasLegs = day.exercises.some(
        (exercise) => candidateById.get(exercise.exerciseId)?.region === "legs",
      );
      day.name = adaptedDayName(day.name, limitations, hasLegs);
    }
  }
  plan.model = starter ? "starter:rules-v1" : "weekly:rules-v2";
  plan.summary = injuryNote
    ? `${injuryNote} Built from your confirmed schedule, experience and equipment.`
    : `A rules-based ${starter ? "starter " : ""}week built from your confirmed schedule, experience and equipment${starter ? "" : " and recorded performance"}. AI planning was unavailable.`;
  plan.warnings = [
    ...(injuryNote ? [injuryNote] : []),
    "Rules-based plan. Starting loads are not a strength assessment. Record your reps and effort before progressing.",
  ];
  plan.nutrition = {
    status: "NEEDS_INPUT",
    targets: null,
    days: [],
    reason:
      "Personalized food recommendations are unavailable. No meals have been invented.",
  };
  if (plan.workouts.some((day) => !day.restDay && day.exercises.length === 0)) {
    throw new PlannerError(
      "CATALOG_GAP",
      "Your equipment does not support a complete starter week.",
      422,
    );
  }
  await report("validation", "nutrition");
  validatePlan(snapshot, plan);
  await report("saving", "validation");
  return plan;
}

export async function generateWeeklyWithFallback(
  generate: () => Promise<WeeklyPlan>,
  snapshot: Snapshot,
  report: StageReporter = async () => {},
) {
  try {
    return await generate();
  } catch (error) {
    if (
      !(
        error instanceof PlannerError &&
        [
          "MODEL_NOT_CONFIGURED",
          "MODEL_UNAVAILABLE",
          "MODEL_RATE_LIMIT",
          "MODEL_RESPONSE_INVALID",
          "INVALID_TRANSLATION",
          "INCOMPLETE_WORKFLOW",
        ].includes(error.code)
      )
    )
      throw error;
    return buildRulesFallback(snapshot, report);
  }
}

export async function generateStarterWithFallback(
  generate: () => Promise<WeeklyPlan>,
  snapshot: Snapshot,
  report: StageReporter = async () => {},
) {
  try {
    const plan = await generate();
    plan.model = `starter:${plan.model}`;
    const regions = new Map(
      snapshot.candidates.map((candidate) => [candidate.id, candidate.region]),
    );
    for (const exercise of plan.workouts.flatMap((day) => day.exercises)) {
      exercise.region = regions.get(exercise.exerciseId);
    }
    return plan;
  } catch (error) {
    if (!mayUseStarterFallback(error)) throw error;
    return await buildStarterFallback(snapshot, report);
  }
}
