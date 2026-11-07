import { PlannerState, StageReporter } from "./common/state";
import { Snapshot, REGIONS, PlannerError, WeeklyPlan } from "./common/types";
import { prepareNode } from "./nodes/prepare_node";
import { fallbackChoices } from "./common/fallback_choices";
import {
  assembleNode,
  buildRegionalResult,
  validatePlan,
} from "./nodes/validation_node";

export function mayUseStarterFallback(error: unknown) {
  return (
    error instanceof PlannerError &&
    [
      "MODEL_NOT_CONFIGURED",
      "MODEL_UNAVAILABLE",
      "MODEL_RATE_LIMIT",
      "MODEL_RESPONSE_INVALID",
      "INVALID_TRANSLATION",
      "INCOMPLETE_WORKFLOW",
    ].includes(error.code)
  );
}

/** A conservative catalogue-based prescription, never fabricated workout history. */
export async function buildStarterFallback(
  snapshot: Snapshot,
  report: StageReporter = async () => {},
): Promise<WeeklyPlan> {
  return buildRulesFallback(snapshot, report, true);
}

export async function buildRulesFallback(
  snapshot: Snapshot,
  report: StageReporter = async () => {},
  starter = false,
): Promise<WeeklyPlan> {
  if (
    snapshot.profile.age < 18 ||
    snapshot.synthetic ||
    snapshot.profile.limitations.some((value) => value !== "NONE") ||
    snapshot.profile.customLimitations?.trim()
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
  for (const exercise of plan.workouts.flatMap((day) => day.exercises)) {
    const candidate = snapshot.candidates.find(
      (candidate) => candidate.id === exercise.exerciseId,
    );
    exercise.displayName = candidate?.displayName;
    exercise.region = candidate?.region;
    if (starter && exercise.weightBasis !== "bodyweight") {
      exercise.weightKg = null;
      exercise.weightBasis = "establish_starting_load";
      for (const set of exercise.setPrescriptions) set.weightKg = null;
    }
  }
  plan.model = starter ? "starter:rules-v1" : "weekly:rules-v2";
  plan.summary = `A rules-based ${starter ? "starter " : ""}week built from your confirmed schedule, experience and equipment${starter ? "" : " and recorded performance"}. AI planning was unavailable.`;
  plan.warnings = [
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
    if (!mayUseStarterFallback(error)) throw error;
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
    if (
      !mayUseStarterFallback(error) &&
      !(error instanceof PlannerError && error.code === "PLAN_QUALITY")
    )
      throw error;
    return buildStarterFallback(snapshot, report);
  }
}
