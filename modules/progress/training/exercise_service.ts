import prisma from "../../../config/prisma";
import { loadStrengthProfile } from "./strength_rank";
import { contentLocale } from "../../../utils/app_locale";
import { fitnessTerm } from "../../../utils/fitness_locale";
import { resolveMediaUrl } from "../../workout/workout_service";
import { inRange, percentChange, progressRange } from "../progress_range";
import { ListQuery, ProgressError, RangeQuery } from "../progress_types";
import { exerciseSeries, recordEvents, setVolume } from "./exercise_engine";
import { exerciseRank } from "./exercise_rank";
import { trainingData, TrainingData } from "./training_data";

export function exerciseList(
  data: TrainingData,
  query: RangeQuery,
  locale: string,
) {
  const range = progressRange(query, data.sets[0]?.date);
  const ids = [...new Set(data.sets.map((set) => set.workoutItem.workout.id))];
  return ids
    .map((id) => {
      const all = data.sets.filter((set) => set.workoutItem.workout.id === id);
      const exercise = all[0]!.workoutItem.workout;
      const translations = exercise.namesByLang as Record<
        string,
        string
      > | null;
      const selected = all.filter((set) => inRange(set.date, range));
      const series = exerciseSeries(selected);
      const latest = series.at(-1);
      const first = series[0];
      return {
        id,
        name: translations?.[contentLocale(locale)] || exercise.name,
        canonicalName: exercise.name,
        equipment: fitnessTerm(exercise.equipment, locale),
        thumbnailUrl: resolveMediaUrl(exercise.thumbnailUrl),
        muscles: data.mappings.get(id)?.primary ?? [],
        lastTrained: all.at(-1)!.date,
        sessions: series.length,
        loggedSets: selected.length,
        totalReps: selected.reduce((sum, set) => sum + set.reps, 0),
        volume: selected.some(set => (set.weight ?? 0) > 0)
          ? Math.round(selected.reduce((sum, set) => sum + setVolume(set), 0)) : null,
        first: first?.bestSet ?? null,
        firstDate: first?.date ?? null,
        latest: latest?.bestSet ?? null,
        latestDate: latest?.date ?? null,
        change:
          latest?.load != null && first?.load != null && series.length > 1
            ? percentChange(latest.load, first.load)
            : null,
        sparkline: series.some((point) => point.load != null)
          ? series
              .filter((point) => point.load != null)
              .slice(-12)
              .map((point) => ({ date: point.date, value: point.load! }))
          : series
              .slice(-12)
              .map((point) => ({ date: point.date, value: point.reps })),
        metric: series.some((point) => point.load != null) ? "load" : "reps",
      };
    })
    .sort(
      (a, b) =>
        b.lastTrained.localeCompare(a.lastTrained) ||
        a.name.localeCompare(b.name),
    );
}

export async function getExercises(
  owner: string,
  query: ListQuery,
  locale: string,
) {
  const data = await trainingData(
    owner,
    query.period === "custom" ? query.end! : query.date,
    query.dataset,
  );
  const rows = exerciseList(data, query, locale).filter((exercise) => {
    const match = `${exercise.name} ${exercise.canonicalName}`
      .toLowerCase()
      .includes(query.search.toLowerCase());
    return match && (!query.muscle || exercise.muscles.includes(query.muscle));
  });
  const start = query.cursor
    ? rows.findIndex((row) => row.id === query.cursor) + 1
    : 0;
  if (query.cursor && start === 0)
    throw new ProgressError("Invalid page cursor");
  const items = rows.slice(start, start + query.limit);
  return {
    items,
    range: progressRange(query, data.sets[0]?.date),
    nextCursor: start + items.length < rows.length ? items.at(-1)!.id : null,
    total: rows.length,
  };
}

export async function getExercise(
  owner: string,
  id: string,
  query: ListQuery,
  locale: string,
) {
  const [data, profile] = await Promise.all([
    trainingData(
      owner,
      query.period === "custom" ? query.end! : query.date,
      query.dataset,
    ),
    loadStrengthProfile(owner, query.date),
  ]);
  const exercise = exerciseList(data, query, locale).find(
    (row) => row.id === id,
  );
  if (!exercise) throw new ProgressError("Exercise history not found", 404);
  const all = data.sets.filter((set) => set.workoutItem.workout.id === id);
  const range = progressRange(query, all[0]?.date);
  const series = exerciseSeries(all.filter((set) => inRange(set.date, range)));
  const history = [...series].reverse();
  const start = query.cursor
    ? history.findIndex((row) => row.date === query.cursor) + 1
    : 0;
  if (query.cursor && start === 0)
    throw new ProgressError("Invalid page cursor");
  const items = history.slice(start, start + query.limit);
  const bestLoad = all
    .filter((set) => set.weight != null && set.weight > 0)
    .sort((a, b) => b.weight! - a.weight! || b.reps - a.reps)[0];
  const repsAtLoad = new Map<number, (typeof all)[number]>();
  for (const set of all) {
    const load = set.weight ?? 0;
    if ((repsAtLoad.get(load)?.reps ?? 0) < set.reps) repsAtLoad.set(load, set);
  }
  return {
    exercise,
    rank:
      query.dataset === "preview"
        ? null
        : query.period === "custom"
          ? await getExerciseRank(owner, id, query)
          : exerciseRank(all, id, query.date, profile),
    range,
    series,
    previous: exerciseSeries(all).slice(-2),
    records: {
      bestLoad: bestLoad
        ? { weight: bestLoad.weight, reps: bestLoad.reps, date: bestLoad.date }
        : null,
      repsAtLoad: [...repsAtLoad.values()]
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .map((set) => ({ weight: set.weight, reps: set.reps, date: set.date })),
      events: recordEvents(all).filter((event) => inRange(event.date, range))
        .length,
    },
    history: items,
    nextCursor:
      start + items.length < history.length ? items.at(-1)!.date : null,
  };
}

// Rank stays all-time and real-data based, regardless of chart filters or pagination.
export async function getExerciseRank(
  owner: string,
  id: string,
  query: ListQuery,
) {
  const [data, profile, exercise] = await Promise.all([
    trainingData(owner, query.date, "real"),
    loadStrengthProfile(owner, query.date),
    prisma.workout.findUnique({
      where: { id },
      select: { id: true, name: true, equipment: true },
    }),
  ]);
  return exerciseRank(
    data.sets,
    id,
    query.date,
    profile,
    exercise ?? undefined,
  );
}
