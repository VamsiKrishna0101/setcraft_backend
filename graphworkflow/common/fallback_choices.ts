import {
  RegionalChoice,
  Region,
  Snapshot,
  TrainingDay,
  PlannerError,
} from "./types";
import { movementOf, rankedCandidates } from "./coaching";
import { activeLimitations } from "./constraints";
import { exerciseRules } from "./loading";
import { regionRecovery, regionSetBudget, loadGuide } from "./region_input";
import { prescriptionSeconds } from "./session_quality";

// A reproducible, capability-filtered baseline is also the bounded repair path.
// Selection order is familiarity/standard movements, never database ID order.
export function fallbackChoices(
  snapshot: Snapshot,
  schedule: TrainingDay[],
  region: Region,
): RegionalChoice {
  const days = schedule.filter((d) => d.regions.includes(region));
  const pool = rankedCandidates(snapshot, region);
  if (days.length && !pool.length)
    throw new PlannerError(
      "CATALOG_GAP",
      `No suitable ${region} exercises match your equipment.`,
      422,
    );
  const recovery = regionRecovery(snapshot, region).reducedRecovery;
  const limitations = activeLimitations(snapshot.profile);
  const limitationNote = limitations.has("SHOULDER")
    ? " Chosen to avoid shoulder and overhead strain while training the rest of your body."
    : limitations.has("KNEE")
      ? " Chosen to limit deep knee stress."
      : limitations.has("BACK")
        ? " Chosen to avoid heavy spinal loading."
        : limitations.has("WRIST")
          ? " Chosen for gentler wrist positioning."
          : limitations.has("HIP")
            ? " Chosen to reduce deep hip flexion."
            : "";
  let budget = regionSetBudget(snapshot, region, days.length);
  return {
    days: days.map((day, index) => {
      const patterns =
        region === "legs"
          ? limitations.has("KNEE")
            ? ["hip_dominant", "knee_flexion", "calves"]
            : ["knee_dominant", "hip_dominant"]
          : region === "back"
            ? limitations.has("BACK")
              ? ["vertical_pull", "horizontal_pull"]
              : ["horizontal_pull", "vertical_pull"]
            : [];
      const preferred = patterns[index % patterns.length];
      const ranked = [...pool].sort(
        (a, b) =>
          Number(movementOf(b) === preferred) -
          Number(movementOf(a) === preferred),
      );
      const selected: RegionalChoice["days"][number]["exercises"] = [];
      const seen = new Set<string>();
      const usedPatterns = new Set<string>();
      let seconds = 0;
      let quota = Math.max(1, Math.floor(budget / (days.length - index)));
      const candidates = [
        ranked[0],
        // Reserve complementary pulling and lower-body patterns before filling
        // accessory slots; catalogue ranking alone may put many calves first.
        ...patterns.map((pattern) =>
          ranked.find((candidate) => movementOf(candidate) === pattern),
        ),
        ...ranked.filter((c) => movementOf(c) !== movementOf(ranked[0]!)),
        ...ranked,
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (
          !candidate ||
          seen.has(candidate.id) ||
          selected.length >= (day.exerciseSlots[region] ?? 1)
        )
          continue;
        seen.add(candidate.id);
        const pattern = `${movementOf(candidate)}:${candidate.subTarget ?? ""}`;
        if (
          usedPatterns.has(pattern) &&
          region !== "legs" &&
          region !== "shoulders"
        )
          continue;
        const rules = exerciseRules(snapshot, candidate, recovery);
        let sets = Math.min(rules.recommendedSets, quota);
        // A small recorded budget can still cover two complementary movements;
        // do not spend every available set on the first candidate.
        if (
          selected.length === 0 &&
          quota >= 2 &&
          (day.exerciseSlots[region] ?? 1) >= 2 &&
          ranked.some(
            (other) =>
              movementOf(other) !== movementOf(candidate) ||
              other.subTarget !== candidate.subTarget,
          )
        ) {
          sets = Math.min(sets, quota - 1);
        }
        if (!sets) break;
        const reps = rules.recommendedReps;
        const rest = rules.minRestSeconds;
        const availableSeconds =
          (day.minutesByRegion?.[region] ?? day.minutesPerRegion) * 60 -
          seconds;
        while (
          sets > (recovery ? 1 : 2) &&
          prescriptionSeconds(sets, reps, rest) > availableSeconds
        )
          sets--;
        const duration = prescriptionSeconds(sets, reps, rest);
        if (
          seconds + duration >
          (day.minutesByRegion?.[region] ?? day.minutesPerRegion) * 60
        )
          continue;
        const load = loadGuide(snapshot, candidate, recovery);
        selected.push({
          exerciseId: candidate.id,
          sets,
          repsMin: reps,
          repsMax: reps,
          weightKg: load.suggestedKg,
          targetRpe: Math.min(7, rules.maxTargetRpe),
          restSeconds: rest,
          reason: `${load.hasHistory ? "Retained a recorded movement" : "A manageable starting movement"} for your ${snapshot.profile.location === "HOME" ? "home equipment" : "available equipment"} and ${snapshot.profile.minutes}-minute session.${limitationNote}`,
          progression: load.note,
        });
        usedPatterns.add(pattern);
        seconds += duration;
        quota -= sets;
        budget -= sets;
      }
      if (!selected.length)
        throw new PlannerError(
          "CATALOG_GAP",
          `A useful ${region} prescription does not fit your available time and equipment.`,
          422,
        );
      return { date: day.date, exercises: selected };
    }),
  };
}
