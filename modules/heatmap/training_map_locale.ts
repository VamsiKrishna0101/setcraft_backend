import { fitnessTerm } from "../../utils/fitness_locale";
import type { buildTrainingMap } from "./training_map_engine";

/** Localise display strings after canonical muscle mapping and set accounting. */
export function localizeTrainingMap(
  map: ReturnType<typeof buildTrainingMap>,
  locale: string,
  names: ReadonlyMap<string, string> = new Map(),
) {
  const name = (value: string) => names.get(value) || value;
  return {
    ...map,
    checkInMethod: fitnessTerm(map.checkInMethod, locale),
    countingMethod: fitnessTerm(map.countingMethod, locale),
    regions: map.regions.map((region) => {
      const remaining =
        /^(\d+) planned direct sets remain due (this week|for this day)\.$/.exec(
          region.insight,
        );
      return {
        ...region,
        strength: {
          ...region.strength,
          exercises: region.strength.exercises.map((exercise) => ({
            ...exercise,
            exerciseName: name(exercise.exerciseName),
          })),
        },
        label: fitnessTerm(region.label, locale),
        insight: remaining
          ? fitnessTerm(
              remaining[2] === "for this day"
                ? "{count} planned direct sets remain due for this day."
                : "{count} planned direct sets remain due this week.",
              locale,
            ).replace("{count}", remaining[1]!)
          : fitnessTerm(region.insight, locale),
        sessions: region.sessions.map((session) => ({
          ...session,
          exercises: session.exercises.map(name),
          exerciseDetails: session.exerciseDetails.map((exercise) => ({
            ...exercise,
            name: name(exercise.name),
          })),
        })),
        loggedExercises: region.loggedExercises.map((exercise) => ({
          ...exercise,
          name: name(exercise.name),
        })),
        trendExercise: region.trendExercise ? name(region.trendExercise) : null,
        nextExercises: region.nextExercises.map((exercise) => ({
          ...exercise,
          name: name(exercise.name),
        })),
      };
    }),
  };
}
