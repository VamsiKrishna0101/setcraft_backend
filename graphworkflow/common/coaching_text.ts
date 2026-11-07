import { Candidate, Snapshot } from "./types";
import { groundedReason } from "./coaching";
import { LoadGuide } from "./region_input";

/** Keep the model's brief explanation when it fits the qualitative contract.
 * Numeric prescriptions and progression remain owned by the validated backend. */
export function conciseReason(raw: string, snapshot: Snapshot, candidate: Candidate, reducedRecovery: boolean) {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length > 0 && text.length <= 160 &&
      !/\d|guarantee|diagnos|\bcure\b|\bheal\b|injury.safe|pain.free|medically.safe|body.fat|weakness|symmetry.score/i.test(text)) return text;
  return groundedReason(snapshot, candidate, reducedRecovery).slice(0, 160);
}

export function conciseProgression(guide: LoadGuide, reducedRecovery: boolean, maxReps: number, prescribedWeights: Array<number | null> = []) {
  if (reducedRecovery && guide.action === "bodyweight") return "Keep the prescribed reps manageable while recovery improves.";
  if (guide.action === "bodyweight") return "Build controlled reps before trying a harder variation.";
  if (guide.action === "start") return "Choose a manageable load and record your reps and effort.";
  if (guide.action === "deload") return "Use the reduced load and rebuild controlled, manageable reps.";
  if (reducedRecovery) return "Repeat the prescribed load while recovery improves; record effort.";
  if (guide.action === "progress") {
    const increased = prescribedWeights.some((weight, index) => weight != null && guide.lastSets[index]?.weightKg != null && weight > guide.lastSets[index]!.weightKg!);
    return increased ? "Use the prescribed increase; record reps and effort before progressing again." : "Repeat the prescribed load and record reps and effort before increasing.";
  }
  if (guide.lastSets.some(set => set.rpe == null))
    return "Repeat the prescribed load and record effort before increasing.";
  return `Keep this load and build toward ${maxReps} controlled reps per set.`;
}
