// Planning and live sessions share these assumptions: four seconds per rep,
// the prescribed rest after every set (the last one covers catching breath
// before moving on), and two minutes to walk over, load and set up the next
// exercise. Real gym sessions run about 3 minutes per working set.
export const CHANGEOVER_SECONDS = 120;
export const prescriptionSeconds = (sets: number, reps: number, rest: number) =>
  sets * reps * 4 + Math.max(0, sets) * rest + CHANGEOVER_SECONDS;

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
