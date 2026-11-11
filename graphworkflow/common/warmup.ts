import { appLocale } from '../../utils/app_locale';
import { ExercisePlan, Snapshot } from './types';
import { equipmentStepKg, roundDown } from './loading';
import { hasEquipmentItem } from './catalog';
import { warmupCopy, WarmupCopyKey } from './warmup_copy';

export type Warmup = {
  durationMinutes: number;
  note: string;
  steps: Array<{
    name: string;
    instruction: string;
    seconds: number;
    exerciseId?: string;
    reps?: number;
    weightKg?: number | null;
  }>;
};

type DayKind = 'lower' | 'push' | 'pull' | 'full';

/**
 * A deterministic five-minute preparation: raise temperature, mobilise the
 * joints the session uses, activate with equipment the user actually has, then
 * rehearse or ramp up to the first working exercise.
 *
 * Choices come from the session, equipment, stated limitations and experience.
 * Gender never changes the warm-up.
 */
export function buildWarmup(snapshot: Snapshot, exercises: ExercisePlan[]): Warmup | undefined {
  if (!exercises.length) return undefined;
  const { profile } = snapshot;
  const copy = warmupCopy(appLocale(profile.language));
  const step = (key: WarmupCopyKey, seconds: number, reps?: number) => ({
    name: copy[key].name,
    instruction: copy[key].instruction,
    seconds,
    ...(reps ? { reps } : {}),
  });

  const limits = new Set(profile.limitations.filter(value => value !== 'NONE'));
  const customLimit = !!profile.customLimitations?.trim();
  const has = (limit: string) => limits.has(limit);
  // Self-reported experience, not log history: an experienced lifter's first
  // week in the app should not be warmed up like a novice.
  const beginner = profile.experience?.toUpperCase() === 'BEGINNER';
  const band = hasEquipmentItem(profile, ['resistance bands', 'resistance band', 'bands', 'mini bands']);
  const pullupBar = hasEquipmentItem(profile, ['pullup bar', 'pull up bar', 'assisted pullup dip']);

  const first = exercises[0]!;
  const candidates = new Map(snapshot.candidates.map(c => [c.id, c]));
  const candidate = candidates.get(first.exerciseId);
  const regions = new Set(exercises.map(e => candidates.get(e.exerciseId)?.region).filter(Boolean));
  const lower = regions.has('legs');
  const push = regions.has('chest') || regions.has('triceps') || regions.has('shoulders');
  const pull = regions.has('back') || regions.has('biceps');
  const kind: DayKind =
    (lower && (push || pull)) || (push && pull) || profile.trainingSplit === 'FULL_BODY'
      ? 'full'
      : lower ? 'lower' : pull ? 'pull' : 'push';

  // 1. Pulse raiser.
  const pulse = step(
    customLimit || has('OTHER') || has('KNEE') || has('HIP') || has('BACK')
      ? 'pulseGentle'
      : profile.location === 'HOME' ? 'pulseHome' : 'pulseGym',
    60,
  );

  // 2. Mobility for the joints this session loads; no kneeling with wrist limits.
  const mobility = step(
    kind === 'lower'
      ? has('KNEE') || has('HIP') ? 'mobLowerSafe' : 'mobLower'
      : kind === 'push'
        ? has('SHOULDER') ? 'mobPushSafe' : 'mobPush'
        : kind === 'pull'
          ? has('WRIST') || has('BACK') ? 'mobPullStanding' : 'mobPull'
          : has('WRIST') || has('BACK') ? 'mobFullStanding' : 'mobFull',
    60,
  );

  // 3. Activation that needs only confirmed equipment.
  const gentleUpper = beginner || has('SHOULDER') || has('WRIST');
  const activation =
    kind === 'lower'
      ? has('KNEE') || has('HIP') ? step('actBridges', 60, 10) : step('actBridgesSquats', 60, 10)
      : kind === 'push'
        ? gentleUpper ? step('actWallPush', 60, 10) : step('actInclinePush', 60, 8)
        : kind === 'pull'
          ? band
            ? step('actBandPullApart', 60, 15)
            : pullupBar && !beginner && !has('SHOULDER')
              ? step('actScapPull', 60, 8)
              : step('actYtw', 60, 5)
          : gentleUpper ? step('actFullGentle', 60, 10) : step('actFull', 60, 10);

  // 4. Rehearse the first exercise, or ramp up to a known working load.
  const knownLoad =
    !!candidate && !candidate.bodyweight && !!first.weightKg && first.weightKg > 0 &&
    !!first.weightUnit && first.weightUnit !== 'as_logged' && first.weightUnit !== 'bodyweight';
  const fixedBar = !!candidate && /barbell|smith/i.test(candidate.equipment);
  const load = (fraction: number) => {
    if (!knownLoad) return null;
    const result = roundDown(first.weightKg! * fraction, equipmentStepKg(candidate!, profile));
    // A bar has a fixed minimum; never prescribe a load below it.
    if (fixedBar && result < 20) return null;
    return result > 0 && result < first.weightKg! ? result : null;
  };
  const exerciseStep = (key: WarmupCopyKey, seconds: number, reps: number, weightKg: number | null) => ({
    name: first.name,
    exerciseId: first.exerciseId,
    reps,
    seconds,
    weightKg,
    instruction: copy[key].instruction,
  });

  const rampUp = knownLoad && !beginner && !!candidate?.compound;
  const finalSteps = rampUp
    ? [
        exerciseStep('rampLight', 60, 8, load(0.5)),
        exerciseStep('rampHeavy', 60, 3, load(0.75)),
      ]
    : (() => {
        const weightKg = load(0.4);
        return [exerciseStep(weightKg ? 'rehearsalLoad' : 'rehearsalFree', 120, 8, weightKg)];
      })();

  return {
    durationMinutes: 5,
    note: copy.note.instruction,
    steps: [pulse, mobility, activation, ...finalSteps],
  };
}
