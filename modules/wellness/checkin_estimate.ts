/** A transparent fitness check-in estimate, not a measured recovery score. */
export function computeCheckInEstimate(entry: {
  sleepMinutes: number; rested: number | null; energy: number | null; soreness: number | null;
}): number | null {
  const rating = (v: number | null): v is number => v != null && Number.isInteger(v) && v >= 1 && v <= 5;
  if (!Number.isInteger(entry.sleepMinutes) || entry.sleepMinutes < 0 || entry.sleepMinutes > 1440 ||
      !rating(entry.rested) || !rating(entry.energy) || !rating(entry.soreness)) return null;
  // Sleep duration 40%; reported rest, energy and inverse soreness 20% each.
  // Longer sleep is capped; none of these inputs is a heart measurement.
  const score = Math.round(Math.min(entry.sleepMinutes / 480, 1) * 40 +
    (entry.rested - 1) / 4 * 20 + (entry.energy - 1) / 4 * 20 +
    (5 - entry.soreness) / 4 * 20);
  // Product guardrails, not clinical thresholds: short reported sleep must
  // not produce a high-readiness headline from the other answers alone.
  return Math.min(score, entry.sleepMinutes < 240 ? 33 : entry.sleepMinutes < 360 ? 66 : 100);
}
