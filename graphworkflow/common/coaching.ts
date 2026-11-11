import { Candidate, Programme, Region, Snapshot } from "./types";
import { equipmentAllowed } from "./catalog";
import { exerciseAllowedByLimitations } from "./constraints";

export const REGION_MUSCLES: Record<Region, string[]> = {
  chest: ["chest"],
  back: ["upper_back", "lats", "lower_back"],
  legs: ["glutes", "quads", "hamstrings", "calves"],
  shoulders: ["shoulders"],
  biceps: ["biceps", "forearms"],
  triceps: ["triceps"],
  core: ["core"],
};

export function isFocusedRegion(focus: string[], region: Region) {
  return (
    focus.includes(region) ||
    REGION_MUSCLES[region].some((m) => focus.includes(m))
  );
}

// Selection policies, not claims of medical suitability. Keep the eligible pool
// conservative until exercise-specific performance demonstrates familiarity.
const HIGH_SKILL =
  /pistol|handstand|muscle.?up|planche|front.?lever|dragon|archer|clap|plyo|snatch|clean and|jerk|behind.?neck|one.?arm.*push.?up|clock push|standing.*row.*towel|quarter squat|partial.*squat|zercher|cossack|kneeling.*squat/i;
const BEGINNER_MOVEMENTS =
  /press|push.?up|row|pull.?down|pulldown|squat|lunge|split squat|step.?up|deadlift|hip thrust|bridge|leg curl|leg extension|calf|calves|curl|pushdown|push.down|triceps.*extension|lateral.*raise|rear.*raise|reverse fly|face pull|crunch|dead bug|bird dog|pallof|wood.?chop|reverse.*snow.*angel|superman/i;

export function familiarDates(snapshot: Snapshot, candidate: Candidate) {
  return [
    ...new Set(
      snapshot.sets
        .filter(
          (s) =>
            s.exerciseId === candidate.id &&
            !s.synthetic &&
            s.date <= snapshot.cutoff &&
            s.reps > 0 &&
            s.rpe != null &&
            s.rpe <= 8,
        )
        .map((s) => s.date),
    ),
  ];
}

export function exerciseEligible(snapshot: Snapshot, candidate: Candidate) {
  if (!equipmentAllowed(candidate, snapshot.profile)) return false;
  if (!exerciseAllowedByLimitations(candidate, snapshot.profile)) return false;
  const familiar = familiarDates(snapshot, candidate).length >= 2;
  if (HIGH_SKILL.test(candidate.name) && !familiar) return false;
  if (snapshot.profile.experience !== "BEGINNER") return true;
  // A small reviewed allowlist corrects imported equipment-based INTERMEDIATE
  // labels without letting every intermediate variation into a beginner plan.
  const stableFly = /^(lever seated fly|lever pec deck fly|cable standing fly|cable middle fly)( \(.*\))?$/i.test(candidate.name);
  const stableFundamental = stableFly || /^(cable (seated row|straight back seated row|lat pulldown|pushdown|triceps pushdown)|lat pulldown|lever (seated row|chest press|leg extension|lying leg curl)|sled (45.? leg press|leg press))( \(.*\))?$/i.test(candidate.name);
  if ((/advanced|expert/i.test(candidate.difficulty ?? "") ||
      (/intermediate/i.test(candidate.difficulty ?? "") && !stableFundamental)) && !familiar)
    return false;
  if (
    candidate.bodyweight &&
    /pull.?up|chin.?up|dip/i.test(candidate.name) &&
    !familiar
  )
    return false;
  return familiar || stableFly || BEGINNER_MOVEMENTS.test(candidate.name);
}

export function movementOf(candidate: Candidate): string {
  const name = candidate.name;
  switch (candidate.region) {
    case "chest":
      return /fly|crossover/i.test(name)
        ? "chest_adduction"
        : "horizontal_push";
    case "back":
      return /pull.?down|pull.?up|chin.?up/i.test(name)
        ? "vertical_pull"
        : /row/i.test(name)
          ? "horizontal_pull"
          : "back_accessory";
    case "legs":
      return /leg curl/i.test(name)
        ? "knee_flexion"
        : /calf|calves/i.test(name)
          ? "calves"
          : /deadlift|good morning|hip thrust|bridge|glute.*kick/i.test(name)
            ? "hip_dominant"
            : /squat|lunge|leg press|leg extension|step.?up/i.test(name)
              ? "knee_dominant"
              : "leg_accessory";
    case "shoulders":
      return /press/i.test(name)
        ? "vertical_push"
        : /rear|reverse|face pull/i.test(name)
          ? "rear_delts"
          : "side_delts";
    default:
      return candidate.region;
  }
}

function selectionScore(snapshot: Snapshot, candidate: Candidate) {
  let score = 0;
  const name = candidate.name;
  const dates = familiarDates(snapshot, candidate).length;
  if (dates >= 2) score += 100;
  else if (dates) score += 30;
  if (snapshot.programmeMemory?.exerciseIds.includes(candidate.id)) score += 35;
  if (candidate.primary.some((m) => snapshot.profile.focusMuscles.includes(m)))
    score += 12;
  if (candidate.compound) score += 10;
  if (/clock|towel|alternating.*press|around|twist.*press/i.test(name))
    score -= 35;
  if (
    /machine|leverage|sled|cable/i.test(candidate.equipment) &&
    snapshot.profile.location !== "HOME"
  )
    score += 18;
  if (
    /chest press|floor press|goblet squat|leg press|seated.*row|supported.*row|lat.*pull.?down|romanian.*deadlift|hip thrust|glute bridge|leg curl|lateral raise|pushdown|dead bug/i.test(
      name,
    )
  )
    score += 20;
  if (/incline.*push.?up|wall.*push.?up|kneeling.*push.?up/i.test(name))
    score += 20;
  if (
    /barbell/i.test(candidate.equipment) &&
    snapshot.profile.experience === "BEGINNER" &&
    dates < 2
  )
    score -= 15;
  return score;
}

export function rankedCandidates(snapshot: Snapshot, region: Region) {
  return snapshot.candidates
    .filter((c) => c.region === region && exerciseEligible(snapshot, c))
    .sort(
      (a, b) =>
        selectionScore(snapshot, b) - selectionScore(snapshot, a) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

export function groundedReason(
  snapshot: Snapshot,
  candidate: Candidate,
  reducedRecovery: boolean,
) {
  const familiar = snapshot.sets.some(
    (s) => !s.synthetic && s.exerciseId === candidate.id && s.reps > 0,
  );
  const purpose: Record<string, string> = {
    horizontal_push: "horizontal pressing",
    chest_adduction: "chest accessory work",
    horizontal_pull: "horizontal pulling",
    vertical_pull: "vertical pulling",
    back_accessory: "back accessory work",
    knee_dominant: "knee-dominant lower-body work",
    hip_dominant: "hip-dominant lower-body work",
    knee_flexion: "knee-flexion work",
    calves: "calf work",
    vertical_push: "overhead pressing",
    side_delts: "side-delt work",
    rear_delts: "rear-delt work",
    biceps: "arm flexion",
    triceps: "arm extension",
    core: "trunk work",
  };
  const focus = candidate.primary.some((m) =>
    snapshot.profile.focusMuscles.includes(m),
  );
  const base = familiar ? "Repeats your logged movement so progress stays comparable" : "Introduces " + (purpose[movementOf(candidate)] ?? "a suitable movement") + " with your equipment";
  return base + (reducedRecovery ? " with less work after recent recovery check-ins." : focus ? " for your selected muscle focus." : ".");
}

export function programmeFor(snapshot: Snapshot): Programme {
  const profile = snapshot.profile;
  const previous = snapshot.programmeMemory?.programme;
  const completedDays = new Set(
    snapshot.sets.filter((s) => !s.synthetic && s.reps > 0).map((s) => s.date),
  ).size;
  const lastTrainedOn =
    snapshot.sets
      .filter((s) => !s.synthetic && s.reps > 0)
      .map((s) => s.date)
      .sort()
      .at(-1) ??
    previous?.lastTrainedOn ??
    null;
  const returning =
    !!lastTrainedOn &&
    Date.parse(snapshot.weekStart) - Date.parse(lastTrainedOn) >= 28 * 86400000;
  const environment =
    profile.location === "HOME"
      ? profile.equipmentIds.some((id) => id !== "bodyweight_only") ||
        profile.equipment.some((e) => !/bodyweight|none|other/i.test(e))
        ? "HOME_EQUIPMENT"
        : "HOME_BODYWEIGHT"
      : profile.location === "GYM"
        ? "GYM"
        : "MIXED";
  return {
    startedOn:
      previous?.goal === profile.goal &&
      previous.experience === profile.experience &&
      previous.environment === environment
        ? previous.startedOn
        : snapshot.weekStart,
    goal: profile.goal,
    experience: profile.experience,
    environment,
    phase: returning
      ? "RETURN"
      : profile.experience === "BEGINNER"
        ? completedDays >= 4
          ? "BUILD"
          : "LEARN"
        : "DEVELOP",
    lastTrainedOn,
    anchorExerciseIds: rankedAll(snapshot)
      .filter((c) => familiarDates(snapshot, c).length >= 2)
      .slice(0, 30)
      .map((c) => c.id),
  };
}

function rankedAll(snapshot: Snapshot) {
  return Object.keys(REGION_MUSCLES).flatMap((r) =>
    rankedCandidates(snapshot, r as Region),
  );
}

export function experiencePrompt(snapshot: Snapshot) {
  const programme = programmeFor(snapshot);
  const experience = snapshot.profile.experience;
  const level =
    experience === "BEGINNER"
      ? "BEGINNER POLICY: distinguish a first session from an adapted beginner using actual completed sessions. Choose teachable, stable movements. Do not replace familiar fundamentals with novel variations. Use the prescribed recommendedSets; two sets are an introduction, not a permanent ceiling. Progress only from recorded completion and effort. Explain one achievable next step. Do not require a barbell progression ladder."
      : experience === "INTERMEDIATE"
        ? "INTERMEDIATE POLICY: maintain productive anchor exercises. Balance useful weekly patterns and direct/indirect work. Exercise familiarity is separate from overall experience. Resolve a plateau using repeated performance and recovery, not random exercise rotation or automatic extra sets."
        : "EXPERIENCED POLICY: prioritise the stated goal and focus muscles within demonstrated workload tolerance. Preserve comparable anchor lifts. Novel exercise loads remain unknown. Do not add advanced intensity techniques or complex periodisation merely to look sophisticated.";
  const environment =
    programme.environment === "HOME_BODYWEIGHT"
      ? "HOME BODYWEIGHT POLICY: use only verified equipment. Choose a manageable regression; bodyweight does not imply easy. Progress reps before a harder variation. Do not invent a safe anchor, bench or towel setup. Without a bar, band or suspension trainer, train the upper back with the eligible floor exercises (prone raises, supermans, reverse snow angels); never invent a row or anchor setup."
      : programme.environment === "HOME_EQUIPMENT"
        ? "HOME EQUIPMENT POLICY: use the exact available equipment and bench requirements. Keep setup practical and explain reps-first progression when available load is unknown. Do not assume a full gym or interchangeable machine/dumbbell loads."
        : "GYM/MIXED POLICY: use the supplied equipment inventory. Stable machines and supported movements are valid choices. Minimise unnecessary station changes; keep productive free-weight or bodyweight movements when demonstrated performance supports them.";
  return `${level}\n${environment}\nPROGRAMME PHASE: ${programme.phase}. A return/low-history week re-establishes tolerance; missing records are not proof of inactivity.\nGender alone does not set muscle priorities, exercise difficulty or loading. Individual goals and demonstrated performance govern choices.`;
}
