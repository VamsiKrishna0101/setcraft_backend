// Planning and live sessions share these assumptions: four seconds per rep,
// prescribed rests between sets, and 75 seconds to set up/change exercise.
export const prescriptionSeconds = (sets: number, reps: number, rest: number) =>
  sets * reps * 4 + Math.max(0, sets - 1) * rest + 75;

type Item = { targetSets: number; targetReps: string; restSeconds: number };
export function prescribedWorkoutMinutes(items: Item[], warmupMinutes = 0) {
  if (!items.length) return 0;
  if (
    items.some(
      (item) =>
        !Number.isFinite(item.targetSets) ||
        item.targetSets < 1 ||
        typeof item.targetReps !== "string" ||
        !/\d/.test(item.targetReps) ||
        !Number.isFinite(item.restSeconds),
    )
  )
    return 0;
  const seconds = items.reduce(
    (sum, item) => {
      const reps = item.targetReps.match(/\d+/g)?.map(Number) ?? [12];
      return (
        sum +
        prescriptionSeconds(
          Math.max(1, item.targetSets),
          Math.max(...reps),
          Math.max(0, item.restSeconds),
        )
      );
    },
    Math.max(0, warmupMinutes) * 60,
  );
  return Math.ceil(seconds / 60);
}
