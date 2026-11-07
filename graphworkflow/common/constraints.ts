import { Candidate, Profile } from "./types";

const muscles: Record<string, string[]> = {
  chest: ["chest"], back: ["lats", "upper_back", "lower_back"],
  leg: ["quads", "hamstrings", "glutes", "calves"], legs: ["quads", "hamstrings", "glutes", "calves"],
  shoulder: ["shoulders"], shoulders: ["shoulders"], biceps: ["biceps"], triceps: ["triceps"],
  core: ["core"], abs: ["core"], glutes: ["glutes"], quads: ["quads"], hamstrings: ["hamstrings"], calves: ["calves"],
};

/** Only explicit exclusions are extracted from notes. Other movement notes still
 * go to the coach; an unrecognized phrase is never treated as medical clearance. */
export function explicitExcludedMuscles(profile: Profile) {
  const excluded = new Set<string>();
  const notes = profile.customLimitations ?? "";
  const pattern = /\b(?:avoid|skip|no|do not train|don't train|do not load|don't load|do not touch|don't touch)\s+(?:training\s+)?(?:my\s+|the\s+)?(?:(?:left|right|both)\s+)?(chest|back|legs?|shoulders?|biceps|triceps|core|abs|glutes|quads|hamstrings|calves)\b(?!\s+(?:pain|injury|injuries|strain))/gi;
  for (const match of notes.matchAll(pattern))
    for (const muscle of muscles[match[1]!.toLowerCase()] ?? []) excluded.add(muscle);
  return excluded;
}

// Conservative selection constraints, not a claim that every remaining exercise
// is appropriate for a particular injury. Apply to selections AND alternatives.
export function exerciseAllowedByLimitations(candidate: Candidate, profile: Profile) {
  const excluded = explicitExcludedMuscles(profile);
  if ([...candidate.primary, ...candidate.secondary].some(muscle => excluded.has(muscle))) return false;
  const name = candidate.name.toLowerCase();
  const demands = (candidate.movementDemands ?? []).join(" ").toLowerCase();
  for (const limitation of profile.limitations) {
    if (limitation === "SHOULDER" && (/overhead|military|behind.*neck|\bdip\b/.test(name) || /overhead|deep shoulder extension/.test(demands))) return false;
    if (limitation === "KNEE" && (/squat|lunge|jump|step.?up/.test(name) || /deep knee flexion|high impact/.test(demands))) return false;
    if (limitation === "BACK" && (/deadlift|good morning|bent.?over.*row/.test(name) || /heavy spinal loading/.test(demands))) return false;
    if (limitation === "WRIST" && (/barbell.*curl|straight.*bar|\bclean\b/.test(name) || /loaded wrist extension/.test(demands))) return false;
    if (limitation === "HIP" && (/sumo|wide.*squat|hip thrust/.test(name) || /deep hip flexion/.test(demands))) return false;
  }
  return true;
}
