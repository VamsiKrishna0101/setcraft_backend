import {
  exerciseStrength,
  muscleStrength,
  StrengthProfile,
  strengthReference,
} from "../progress/training/strength_rank";
// A training map describes logged exercise exposure, not photographed anatomy.
export const MUSCLE_IDS = [
  "chest",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "upper_back",
  "lats",
  "lower_back",
  "core",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
] as const;
export type MuscleId = (typeof MUSCLE_IDS)[number];
export const MUSCLE_LABELS: Record<MuscleId, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  upper_back: "Upper back",
  lats: "Lats",
  lower_back: "Lower back",
  core: "Core",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};
export type Exercise = {
  id: string;
  name: string;
  target: string | null;
  muscleGroup: string | null;
  bodyPart: string;
  secondaryMuscles: string[];
  equipment?: string;
};
export type TrainingSet = {
  id: string;
  itemId: string;
  setNumber: number;
  date: string;
  weightUnit?: string;
  createdAt?: Date;
  weight: number | null;
  reps: number;
  exercise: Exercise;
};
export type PlannedExercise = {
  itemId: string;
  targetSets: number;
  dayOfWeek: string;
  exercise: Exercise;
};
export type CheckIn = { muscleId: string; soreness: number; date: string };
export type TrainingSelection = {
  from?: string;
  dates?: string[];
  all?: boolean;
};
const days = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const includes = (text: string, ...words: string[]) =>
  words.some((word) => ` ${text} `.includes(` ${word} `));

function fromTag(value: string): MuscleId[] {
  const text = normalize(value);
  if (includes(text, "chest", "pectorals", "pectoral", "pecs"))
    return ["chest"];
  if (includes(text, "shoulders", "shoulder", "delts", "deltoids", "deltoid"))
    return ["shoulders"];
  if (includes(text, "biceps", "bicep", "brachialis")) return ["biceps"];
  if (includes(text, "triceps", "tricep")) return ["triceps"];
  if (includes(text, "forearms", "forearm", "wrist flexors", "wrist extensors"))
    return ["forearms"];
  if (includes(text, "lats", "latissimus dorsi", "latissimus")) return ["lats"];
  if (includes(text, "upper back", "traps", "trapezius", "rhomboids"))
    return ["upper_back"];
  if (
    includes(
      text,
      "lower back",
      "erector spinae",
      "erectors",
      "spinal erectors",
    )
  )
    return ["lower_back"];
  if (includes(text, "abs", "abdominals", "abdominal", "core", "obliques"))
    return ["core"];
  if (includes(text, "glutes", "gluteus maximus", "gluteus medius", "gluteal"))
    return ["glutes"];
  if (includes(text, "quads", "quadriceps", "quadricep")) return ["quads"];
  if (includes(text, "hamstrings", "hamstring")) return ["hamstrings"];
  if (includes(text, "calves", "calf", "gastrocnemius", "soleus"))
    return ["calves"];
  return [];
}

function fromName(name: string): MuscleId[] {
  const text = normalize(name);
  if (
    includes(
      text,
      "lower back curl",
      "back extension",
      "hyperextension",
      "superman",
    )
  )
    return ["lower_back"];
  if (
    includes(
      text,
      "romanian deadlift",
      "leg curl",
      "hamstring curl",
      "good morning",
    )
  )
    return ["hamstrings"];
  if (includes(text, "deadlift", "hip thrust", "glute bridge"))
    return ["glutes"];
  if (
    includes(
      text,
      "bench press",
      "chest press",
      "chest fly",
      "push up",
      "pushup",
      "pec deck",
    )
  )
    return ["chest"];
  if (
    includes(
      text,
      "shoulder press",
      "overhead press",
      "lateral raise",
      "front raise",
      "rear delt",
      "reverse fly",
    )
  )
    return ["shoulders"];
  if (includes(text, "pulldown", "pull up", "pullup", "chin up", "chinup"))
    return ["lats"];
  if (includes(text, "row", "shrug")) return ["upper_back"];
  if (includes(text, "squat", "lunge", "leg press", "step up", "leg extension"))
    return ["quads"];
  if (includes(text, "calf raise")) return ["calves"];
  if (includes(text, "curl") && !includes(text, "leg", "wrist"))
    return ["biceps"];
  if (
    includes(
      text,
      "pushdown",
      "skull crusher",
      "triceps extension",
      "tricep extension",
    )
  )
    return ["triceps"];
  if (includes(text, "wrist curl", "farmer carry", "farmers walk"))
    return ["forearms"];
  if (includes(text, "plank", "crunch", "sit up", "situp", "leg raise"))
    return ["core"];
  return [];
}

export function mapExercise(exercise: Exercise) {
  // Specific target tags win over broad categories such as "upper arms".
  let primary = fromTag(exercise.target ?? "");
  if (!primary.length) primary = fromName(exercise.name);
  if (!primary.length) primary = fromTag(exercise.muscleGroup ?? "");
  if (!primary.length) primary = fromTag(exercise.bodyPart);
  const secondary = [
    ...new Set(exercise.secondaryMuscles.flatMap(fromTag)),
  ].filter((id) => !primary.includes(id));
  return { primary: [...new Set(primary)], secondary };
}

export function calendarWindow(date: string, utcOffsetMinutes: number) {
  const local = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(local.getTime()) ||
    local.toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid calendar date");
  if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 840)
    throw new Error("Invalid UTC offset");
  const week = new Date(local);
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const previous = new Date(week);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const end = new Date(local);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    weekStart: week.toISOString().slice(0, 10),
    previousWeek: previous.toISOString().slice(0, 10),
    startUtc: new Date(week.getTime() - utcOffsetMinutes * 60_000),
    endUtc: new Date(end.getTime() - utcOffsetMinutes * 60_000),
    dayIndex: (local.getUTCDay() + 6) % 7,
  };
}

export function buildTrainingMap(input: {
  date: string;
  utcOffsetMinutes: number;
  sets: TrainingSet[];
  planned: PlannedExercise[];
  checkIns: CheckIn[];
  focusMuscles: string[];
  limitations: string[];
  period?: "day" | "week";
  selection?: TrainingSelection;
  strengthProfile?: StrengthProfile | null;
}) {
  const { weekStart, previousWeek, dayIndex } = calendarWindow(
    input.date,
    input.utcOffsetMinutes,
  );
  // Old clients may have duplicate retries; one set number per exercise/day counts once.
  const unique = new Map<string, TrainingSet>();
  for (const set of input.sets) {
    if (
      set.date > input.date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(set.date) ||
      !Number.isFinite(Date.parse(set.date)) ||
      new Date(set.date).toISOString().slice(0, 10) !== set.date ||
      !Number.isInteger(set.reps) ||
      set.reps <= 0 ||
      !Number.isInteger(set.setNumber) ||
      set.setNumber < 1
    )
      continue;
    const key = `${set.itemId}:${set.date}:${set.setNumber}`;
    const old = unique.get(key);
    if (
      !old ||
      (set.createdAt?.getTime() ?? 0) >= (old.createdAt?.getTime() ?? 0)
    )
      unique.set(key, set);
  }
  const sets = [...unique.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const mapping = new Map<string, ReturnType<typeof mapExercise>>();
  const tags = (exercise: Exercise) => {
    if (!mapping.has(exercise.id))
      mapping.set(exercise.id, mapExercise(exercise));
    return mapping.get(exercise.id)!;
  };
  const selectedDates = input.selection?.dates
    ? new Set(input.selection.dates)
    : null;
  const visibleStart = input.selection?.all
    ? (sets[0]?.date ?? input.date)
    : (input.selection?.from ??
      (selectedDates
        ? [...selectedDates].sort()[0]!
        : input.period === "day"
          ? input.date
          : weekStart));
  const visible = (set: TrainingSet) =>
    set.date >= visibleStart && (!selectedDates || selectedDates.has(set.date));
  const thisWeek = sets.filter(visible);
  const exercises = new Map<string, Exercise>();
  [...thisWeek, ...input.planned].forEach((item) =>
    exercises.set(item.exercise.id, item.exercise),
  );
  const unmapped = [...exercises.values()]
    .filter((exercise) => !tags(exercise).primary.length)
    .map((exercise) => exercise.name);
  // Only exercises performed in the selected period can colour the map. Keep
  // the shared 90-day strength calculation so a Day filter does not erase
  // previously confirmed levels or promote one unusually heavy session.
  const performed = new Map(
    thisWeek.map((set) => [set.exercise.id, set.exercise]),
  );
  const ranks = [...performed.values()]
    .filter((exercise) => strengthReference(exercise))
    .map((exercise) => ({
      exercise,
      rank: exerciseStrength(
        sets,
        exercise,
        input.strengthProfile ?? null,
        input.date,
      ),
    }));
  const regions = MUSCLE_IDS.map((id) => {
    const direct = sets.filter((set) =>
      tags(set.exercise).primary.includes(id),
    );
    const visibleDirect = direct.filter(visible);
    const assisting = thisWeek.filter((set) =>
      tags(set.exercise).secondary.includes(id),
    ).length;
    const completed = visibleDirect.length;
    const previous = direct.filter(
      (set) => set.date >= previousWeek && set.date < weekStart,
    ).length;
    const planned = input.planned.filter((item) =>
      tags(item.exercise).primary.includes(id),
    );
    const target = planned.reduce(
      (sum, item) => sum + Math.max(0, item.targetSets),
      0,
    );
    const due = planned
      .filter((item) => days.indexOf(item.dayOfWeek) <= dayIndex)
      .reduce((sum, item) => sum + Math.max(0, item.targetSets), 0);
    const latest =
      (input.selection ? visibleDirect : direct).at(-1)?.date ?? null;
    const daysAgo =
      latest === null
        ? null
        : Math.round(
            (Date.parse(input.date) - Date.parse(latest)) / 86_400_000,
          );
    const checkIn = input.checkIns.find(
      (item) => item.muscleId === id && item.date === input.date,
    );
    const soreness = checkIn?.soreness ?? null;
    const exposureDates = sets
      .filter(
        (set) =>
          (!input.selection || visible(set)) &&
          (tags(set.exercise).primary.includes(id) ||
            tags(set.exercise).secondary.includes(id)),
      )
      .map((set) => set.date);
    const latestExposure = exposureDates.at(-1) ?? null;
    const exposureDays =
      latestExposure === null
        ? null
        : Math.round(
            (Date.parse(input.date) - Date.parse(latestExposure)) / 86_400_000,
          );
    const checkInStatus =
      soreness === null
        ? "not_reported"
        : ["comfortable", "light_soreness", "sore", "very_sore"][soreness];
    const status =
      target > 0
        ? completed >= target
          ? "complete"
          : completed > 0
            ? "in_progress"
            : due > 0
              ? "due"
              : "upcoming"
        : completed > 0
          ? "trained"
          : "no_target";
    const sessions = [...new Set(visibleDirect.map((set) => set.date))]
      .reverse()
      .map((date) => ({
        date,
        sets: visibleDirect.filter((set) => set.date === date).length,
        exercises: [
          ...new Set(
            visibleDirect
              .filter((set) => set.date === date)
              .map((set) => set.exercise.name),
          ),
        ],
        exerciseDetails: [
          ...new Map(
            visibleDirect
              .filter((set) => set.date === date)
              .map((set) => [
                set.exercise.id,
                { exerciseId: set.exercise.id, name: set.exercise.name },
              ]),
          ).values(),
        ],
      }));
    const exposure = thisWeek.filter(
      (set) =>
        tags(set.exercise).primary.includes(id) ||
        tags(set.exercise).secondary.includes(id),
    );
    const loggedExercises = [...new Set(exposure.map((set) => set.exercise.id))]
      .map((exerciseId) => {
        const logs = exposure.filter((set) => set.exercise.id === exerciseId);
        return {
          exerciseId,
          name: logs[0]!.exercise.name,
          directSets: logs.filter((set) =>
            tags(set.exercise).primary.includes(id),
          ).length,
          assistingSets: logs.filter((set) =>
            tags(set.exercise).secondary.includes(id),
          ).length,
          lastDate: logs.at(-1)!.date,
          // The exercise screen owns the complete history; the sheet previews recent sets.
          sets: logs
            .slice(-12)
            .reverse()
            .map((set) => ({
              date: set.date,
              reps: set.reps,
              weight: set.weight,
              weightUnit: set.weightUnit ?? null,
              setNumber: set.setNumber,
            })),
        };
      })
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    const exerciseCounts = new Map<string, number>();
    visibleDirect.forEach((set) =>
      exerciseCounts.set(
        set.exercise.id,
        (exerciseCounts.get(set.exercise.id) ?? 0) + 1,
      ),
    );
    const trendId = [...exerciseCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const trendSets = visibleDirect.filter(
      (set) =>
        set.exercise.id === trendId && set.weight !== null && set.weight > 0,
    );
    const trend = [...new Set(trendSets.map((set) => set.date))]
      .slice(-8)
      .map((date) => {
        const best = trendSets
          .filter((set) => set.date === date)
          .sort((a, b) => b.weight! - a.weight! || b.reps - a.reps)[0]!;
        return { date, weightKg: best.weight, reps: best.reps };
      });
    const next = planned
      .filter((item) => days.indexOf(item.dayOfWeek) >= dayIndex)
      .sort((a, b) => days.indexOf(a.dayOfWeek) - days.indexOf(b.dayOfWeek))
      .slice(0, 3)
      .map((item) => ({
        id: item.exercise.id,
        name: item.exercise.name,
        dayOfWeek: item.dayOfWeek,
        sets: item.targetSets,
      }));
    const limited = input.limitations.some(
      (part) =>
        part !== "NONE" &&
        ((part === "SHOULDER" &&
          ["chest", "shoulders", "upper_back", "lats"].includes(id)) ||
          (part === "KNEE" && ["quads", "hamstrings", "calves"].includes(id)) ||
          (part === "BACK" &&
            ["lower_back", "upper_back", "core"].includes(id)) ||
          (part === "HIP" && ["glutes", "quads", "hamstrings"].includes(id)) ||
          (part === "WRIST" && ["forearms", "biceps", "triceps"].includes(id))),
    );
    const daily = input.period === "day";
    const insight =
      soreness !== null && soreness >= 1
        ? "You reported soreness here. Review how you feel before your next session."
        : limited
          ? "You noted a limitation affecting this area. Check exercise suitability before training."
          : target > 0 && completed < due
            ? daily
              ? `${due - completed} planned direct sets remain due for this day.`
              : `${due - completed} planned direct sets remain due this week.`
            : target > 0 && completed >= target
              ? daily
                ? "Your logged direct sets meet this day's plan target."
                : "Your logged direct sets meet this week's plan target."
              : input.focusMuscles.includes(id)
                ? "One of your selected training priorities. Open Train to review your plan."
                : target === 0
                  ? "No direct set target in your current plan. You can add exercises in Train."
                  : "Follow your scheduled exercises and log sets to update this map.";
    return {
      id,
      label: MUSCLE_LABELS[id],
      strength: muscleStrength(
        ranks
          .filter(
            ({ exercise, rank }) =>
              tags(exercise).primary.includes(id) && rank.muscles.includes(id),
          )
          .map(({ rank }) => rank),
      ),
      completedSets: completed,
      targetSets: target,
      dueSets: due,
      assistingSets: assisting,
      previousWeekSets: previous,
      status,
      lastTrained: latest,
      lastExposure: latestExposure,
      daysSinceTrained: daysAgo,
      daysSinceExposure: exposureDays,
      checkInStatus,
      soreness,
      isFocus: input.focusMuscles.includes(id),
      hasLimitation: limited,
      insight,
      sessions,
      loggedExercises,
      trendExercise: trendId ? (exercises.get(trendId)?.name ?? null) : null,
      trend,
      nextExercises: next,
    };
  });
  const completedSets = thisWeek.length;
  const targeted = regions.filter((region) => region.targetSets > 0);
  return {
    date: input.date,
    weekStart,
    period: input.period ?? "week",
    periodStart: visibleStart,
    periodEnd: input.date,
    updatedAt: new Date().toISOString(),
    regions,
    summary: {
      loggedSets: completedSets,
      trainedMuscles: regions.filter((region) => region.completedSets > 0)
        .length,
      targetMuscles: targeted.length,
      completedTargets: targeted.filter(
        (region) => region.status === "complete",
      ).length,
      sessions: new Set(thisWeek.map((set) => set.date)).size,
    },
    unmappedExercises: unmapped,
    checkInMethod:
      "Today's soreness is self-reported. Logged exposure dates describe training history, not physiological recovery.",
    countingMethod:
      "Only logged direct sets count toward plan targets. Assisting muscle exposure is shown separately. Duplicate set retries count once. Preview records are excluded.",
  };
}
