import { getPlannedPhysiqueMap } from "./planned_physique_service";
import { getTrainingMap } from "./training_map_service";
import {
  buildTrainingMap,
  calendarWindow,
  TrainingSelection,
} from "./training_map_engine";
import { localizeTrainingMap } from "./training_map_locale";

type Plan = Awaited<ReturnType<typeof getPlannedPhysiqueMap>>;
type Training = Awaited<ReturnType<typeof getTrainingMap>>;

/** Planned quantities come exclusively from the effective dated schedule.
 * Logged quantities remain real direct/assisting exposure, independent of plan IDs. */
export function buildBodyMap(
  plan: Plan,
  training: Pick<Training, "regions" | "summary">,
) {
  const targets = new Map<string, number>();
  let plannedSets = 0;
  for (const day of plan.workouts)
    for (const exercise of day.exercises) {
      plannedSets += exercise.sets;
      for (const id of exercise.primary)
        targets.set(id, (targets.get(id) ?? 0) + exercise.sets);
    }
  const regions = training.regions.map((region) => {
    const planned = targets.get(region.id) ?? 0;
    const completed = region.completedSets;
    return {
      ...region,
      id: region.id,
      label: region.label,
      plannedSets: planned,
      completedSets: completed,
      assistingSets: region.assistingSets,
      lastTrained: region.lastTrained,
      status:
        planned > 0
          ? completed >= planned
            ? "completed"
            : completed > 0
              ? "in_progress"
              : "planned"
          : completed > 0 || region.assistingSets > 0
            ? "logged"
            : "none",
    };
  });
  return {
    date: plan.date,
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    gender: plan.gender,
    planId: plan.planId,
    status: plan.status,
    workouts: plan.workouts,
    regions,
    summary: {
      ...training.summary,
      plannedSets,
      loggedSets: training.summary.loggedSets,
      plannedMuscles: regions.filter((r) => r.plannedSets > 0).length,
      completedTargets: regions.filter((r) => r.status === "completed").length,
    },
  };
}

export async function getBodyMap(
  userId: string,
  date: string,
  offset: number,
  locale?: string,
  selection?: TrainingSelection,
) {
  const today = new Date(Date.now() + offset * 60000)
    .toISOString()
    .slice(0, 10);
  const { weekStart } = calendarWindow(date, offset);
  const currentWeek = calendarWindow(today, offset).weekStart;
  const sunday = new Date(weekStart + "T12:00:00Z");
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  // Current weeks end at today; historical weeks include Sunday.
  const through = selection
    ? date < today
      ? date
      : today
    : weekStart === currentWeek
      ? today
      : sunday.toISOString().slice(0, 10);
  const [plan, training] = await Promise.all([
    getPlannedPhysiqueMap(userId, through, offset, locale),
    weekStart > currentWeek
      ? Promise.resolve(
          localizeTrainingMap(
            buildTrainingMap({
              date: through,
              utcOffsetMinutes: offset,
              sets: [],
              planned: [],
              checkIns: [],
              focusMuscles: [],
              limitations: [],
            }),
            locale || "en",
          ),
        )
      : getTrainingMap(userId, through, offset, locale, "week", selection),
  ]);
  return buildBodyMap(plan, training);
}
