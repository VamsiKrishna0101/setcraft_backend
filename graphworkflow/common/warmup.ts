import { ExercisePlan, Snapshot } from './types';
import { equipmentStepKg, roundDown } from './loading';

export type Warmup = {
  durationMinutes: number;
  note: string;
  steps: Array<{ name: string; instruction: string; seconds: number;
    exerciseId?: string; reps?: number; weightKg?: number | null }>;
};

export function buildWarmup(snapshot: Snapshot, exercises: ExercisePlan[]): Warmup | undefined {
  if (!exercises.length) return undefined;
  const first = exercises[0]!;
  const candidate = snapshot.candidates.find(c => c.id === first.exerciseId);
  const limited = snapshot.profile.limitations.some(v => v !== 'NONE') || !!snapshot.profile.customLimitations?.trim();
  const load = (fraction: number) => {
    // Do not invent a load convention or an equipment minimum (e.g. an empty bar).
    if (!candidate || candidate.bodyweight || !first.weightKg ||
        !first.weightUnit || first.weightUnit === 'as_logged' || /barbell|smith/i.test(candidate.equipment)) return null;
    const result = roundDown(first.weightKg * fraction, equipmentStepKg(candidate, snapshot.profile));
    return result > 0 && result < first.weightKg ? result : null;
  };
  return {
    durationMinutes: 5,
    note: 'Preparation only. These sets do not count towards working sets or strength records. Keep them easy and stop if movement causes pain.',
    steps: [
      {name: 'Easy movement', seconds: 120, instruction: limited
        ? 'Use an easy activity compatible with your stated limitations and any guidance you already follow. Keep the effort comfortable.'
        : snapshot.profile.location === 'GYM'
          ? 'Walk or cycle gently for two minutes. Finish feeling warmer, not tired.'
          : 'Walk or march gently for two minutes, using the space available.'},
      {name: first.name, exerciseId: first.exerciseId, reps: 8, seconds: 90,
        weightKg: load(.4), instruction: 'Practise 8 controlled repetitions with a very light load or an easier variation. Rest briefly. Use equipment you can set up correctly.'},
      {name: first.name, exerciseId: first.exerciseId, reps: 5, seconds: 90,
        weightKg: load(.65), instruction: first.weightKg == null || candidate?.bodyweight
          ? 'Do 5 easy practice repetitions. If your working load is unknown, increase gradually only while technique stays comfortable; the first target is a starting estimate.'
          : 'Do 5 easy repetitions below your working load, then rest before your first working set. If the suggested load is unavailable, choose a lighter practical load.'},
    ],
  };
}
