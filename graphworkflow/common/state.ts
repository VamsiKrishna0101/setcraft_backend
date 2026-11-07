import { Annotation } from "@langchain/langgraph";
import {
  Region,
  RegionalResult,
  Snapshot,
  WeeklyPlan,
  TrainingDay,
} from "./types";
import { PlannerStep } from "../progress";

type RegionalRecommendations = Partial<Record<Region, RegionalResult>>;

function mergeSnapshot(
  previous: Snapshot | undefined,
  incoming: Partial<Snapshot> | undefined,
): Snapshot {
  if (!previous) return incoming as Snapshot;
  if (!incoming) return previous;
  return {
    ...previous,
    ...incoming,
    profile: incoming.profile
      ? { ...previous.profile, ...incoming.profile }
      : previous.profile,
    coverage: incoming.coverage
      ? { ...previous.coverage, ...incoming.coverage }
      : previous.coverage,
  };
}

function mergeSchedule(
  previous: TrainingDay[] | undefined,
  incoming: TrainingDay[] | undefined,
): TrainingDay[] {
  if (!incoming || incoming.length === 0) return previous ?? [];
  return incoming;
}

function mergeInputs(
  previous: Record<Region, Record<string, unknown>> | undefined,
  incoming: Partial<Record<Region, Record<string, unknown>>> | undefined,
): Record<Region, Record<string, unknown>> {
  return {
    ...(previous ?? ({} as Record<Region, Record<string, unknown>>)),
    ...(incoming ?? {}),
  };
}

function mergeRecommendations(
  previous: RegionalRecommendations | undefined,
  incoming: RegionalRecommendations | undefined,
): RegionalRecommendations {
  return { ...(previous ?? {}), ...(incoming ?? {}) };
}

function mergePlan(
  previous: WeeklyPlan | undefined,
  incoming: Partial<WeeklyPlan> | undefined,
): WeeklyPlan {
  if (!previous) return incoming as WeeklyPlan;
  if (!incoming) return previous;
  return {
    ...previous,
    ...incoming,
    programme: incoming.programme
      ? { ...previous.programme, ...incoming.programme }
      : previous.programme,
    nutrition: incoming.nutrition ?? previous.nutrition,
    warnings: Array.from(
      new Set([...(previous.warnings ?? []), ...(incoming.warnings ?? [])]),
    ),
    workouts: incoming.workouts ?? previous.workouts,
  };
}

function mergePromptVersion(
  previous: string | undefined,
  incoming: string | undefined,
): string {
  return incoming ?? previous ?? "";
}

// Reducers on all channels guarantee parallel agents and multi-phase nodes
// merge their updates cleanly without overriding sibling or prior stage data.
// State belongs to one graph run; it is never shared between users.
export const PlannerState = Annotation.Root({
  snapshot: Annotation<Snapshot>({
    reducer: mergeSnapshot,
  }),
  schedule: Annotation<TrainingDay[]>({
    reducer: mergeSchedule,
    default: () => [],
  }),
  inputs: Annotation<Record<Region, Record<string, unknown>>>({
    reducer: mergeInputs,
    default: () => ({} as Record<Region, Record<string, unknown>>),
  }),
  regions: Annotation<RegionalRecommendations>({
    reducer: mergeRecommendations,
    default: () => ({}),
  }),
  plan: Annotation<WeeklyPlan>({
    reducer: mergePlan,
  }),
  promptVersion: Annotation<string>({
    reducer: mergePromptVersion,
    default: () => "",
  }),
});

export type PlannerState = typeof PlannerState.State;

export type StageReporter = (
  stage: string,
  completedStep?: PlannerStep,
) => Promise<void>;
