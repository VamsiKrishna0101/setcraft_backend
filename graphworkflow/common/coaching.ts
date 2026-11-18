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
  if (snapshot.profile.experience === "INTERMEDIATE")
    return familiar || !/advanced|expert/i.test(candidate.difficulty ?? "");
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

// Well-known gym staples per region, matched against the plain catalogue name.
const STAPLES: Record<Region, RegExp> = {
  chest:
    /^(barbell|dumbbell|smith) (incline )?bench press$|^(lever|machine) (seated |incline )?chest press$|^push-?up$|^(dumbbell|cable) (incline )?fly$|^cable (standing|middle|seated chest) fly$|^pec deck|^lever seated fly$/,
  back: /^pull-?up$|^chin-?up$|lat(eral)? pull-?down|^(cable|lever) seated row$|^cable (low|rope) seated row$|^(barbell|dumbbell) bent over row$|^dumbbell (one|single) arm row$|^t-?bar row/,
  legs: /^barbell (full |back |front )?squat$|^dumbbell goblet squat$|^(barbell|dumbbell) romanian deadlift$|^sled 45.?degrees? leg press$|^(lever|smith) (seated )?leg press$|^lever leg extension$|^lever (lying|seated) leg curl$|^(barbell|dumbbell) (walking |rear )?lunge$|^dumbbell (goblet )?(bulgarian )?split squat$|^barbell hip thrust$|^(barbell|lever|dumbbell) (standing |seated )?calf raise$/,
  shoulders:
    /^dumbbell (seated )?shoulder press$|^barbell (seated )?(overhead|military) press$|^(lever|smith) (seated )?shoulder press$|^(dumbbell|cable) lateral raise$|^cable (rope )?face pull$|^dumbbell rear (delt|lateral) (raise|fly)$|^lever (seated )?reverse fly$/,
  biceps:
    /^(barbell|dumbbell|ez barbell|cable) curl$|^(dumbbell|cable) hammer curl$|^(barbell|dumbbell|ez barbell|lever) preacher curl$|^dumbbell incline curl$/,
  triceps:
    /^cable (triceps |tricep )?pushdown( \(with rope attachment\))?$|^cable (rope )?overhead triceps extension$|^dumbbell (seated |standing )?(overhead )?triceps extension$|^(barbell|ez barbell) lying triceps extension$|skull ?crusher$|^(barbell )?close.?grip bench press$|^bench dip$/,
  core: /^dead bug$|^(cable |dumbbell )?crunch$|^cable kneeling crunch$|^hanging (knee|leg) raise$|^(cable|band) horizontal pallof press$|^ab wheel|^lying leg raise$|^decline crunch$/,
};

// The main lift of each pattern outranks its accessory cousins.
const PRIMARY =
  /bench press$|^barbell (full |back )?squat$|leg press$|romanian deadlift$|lat(eral)? pull-?down|^pull-?up$|seated row$|bent over row$|shoulder press$|lateral raise$|^(barbell|dumbbell|cable) curl$|pushdown$|^dead bug$/;

// Catalogue artefacts and novelty variants that make a plan look random.
const ODD =
  /\bpov\b|\(version|\(variation|\bv\.? ?\d|\((male|female)\)|\[|\bon (floor|box|knees)\b|\blying floor\b|\bwall\b|glute bridge .*(press|crusher|fly)|explosive|plyo|pulse|\bjump|\bslam|\bto (bent over |hammer )?(row|curl|press)|with (calf raise|overhead press)|side shuffle|squeez|\bclock\b|\btowel\b|around|curtsey|spell caster|landmine 180|pull in sit/i;
const UNILATERAL =
  /\b(one|single) (arm|leg)\b|alternat|ipsilateral|contralateral|kneeling|half kneeling/i;

function selectionScore(snapshot: Snapshot, candidate: Candidate) {
  let score = 0;
  const name = candidate.name;
  const plain = name.toLowerCase().trim();
  const { experience, goal, location } = snapshot.profile;
  const beginner = experience === "BEGINNER";
  const home = location === "HOME";
  const dates = familiarDates(snapshot, candidate).length;
  if (dates >= 2) score += 100;
  else if (dates) score += 30;
  if (snapshot.programmeMemory?.exerciseIds.includes(candidate.id)) score += 35;
  if (candidate.primary.some((m) => snapshot.profile.focusMuscles.includes(m)))
    score += 12;
  if (candidate.compound) score += 10;

  if (STAPLES[candidate.region].test(plain)) score += 40;
  if (PRIMARY.test(plain)) score += 10;
  if (ODD.test(name)) score -= 40;
  if (UNILATERAL.test(name)) score -= 10;
  score -= Math.max(0, name.split(/\s+/).length - 4) * 3;

  const machine = /machine|leverage|sled|cable|smith/i.test(candidate.equipment);
  const freeWeight = /barbell|dumbbell/i.test(candidate.equipment);
  if (!home && machine) score += beginner ? 16 : 8;
  if (!beginner && freeWeight) score += 8;
  if (/strong/i.test(goal) && !beginner && candidate.compound && /barbell/i.test(candidate.equipment))
    score += 15;
  if (/muscle/i.test(goal) && !beginner && (machine || freeWeight)) score += 4;

  // Easier push-up regressions help beginners and bodyweight-only users only.
  if (/incline.*push.?up|wall.*push.?up|kneeling.*push.?up/i.test(name))
    score += beginner || home ? 20 : -20;
  if (/barbell/i.test(candidate.equipment) && beginner && dates < 2)
    score -= 15;
  return score;
}

// Variants that differ only by camera angle, version or catalogue code.
function canonicalName(name: string) {
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]|\((back |side )?pov\)|\((version|variation)[^)]*\)|\bv\.? ?\d+\b|\bconventional\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function rankedCandidates(snapshot: Snapshot, region: Region) {
  const seen = new Set<string>();
  return snapshot.candidates
    .filter((c) => c.region === region && exerciseEligible(snapshot, c))
    .map((candidate) => ({ candidate, score: selectionScore(snapshot, candidate) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.name.length - b.candidate.name.length ||
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .map(({ candidate }) => candidate)
    .filter((candidate) => {
      const key = canonicalName(candidate.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
