import { LoggedSet } from './training_data';

export function estimatedStrength(set: LoggedSet): number | null {
  const exercise = set.workoutItem.workout;
  const excluded = /body\s*weight|assisted|band|cardio|stretch/i.test(`${exercise.equipment} ${exercise.category} ${exercise.name}`);
  if (excluded || !set.weight || set.weight <= 0 || set.reps > 12) return null;
  return Math.round(set.weight * (1 + set.reps / 30) * 10) / 10;
}

export function setVolume(set: LoggedSet) {
  return set.weight != null && set.weight > 0 ? set.weight * set.reps : 0;
}

export function recordEvents(sets: LoggedSet[]) {
  const best = new Map<string, { load: number; reps: Map<number, number>; volume: number }>();
  const events: Array<{ date: string; exerciseId: string; setId: string; kinds: string[] }> = [];
  for (const set of sets) {
    const id = set.workoutItem.workout.id;
    const load = set.weight ?? 0;
    const previous = best.get(id);
    const kinds: string[] = [];
    if (previous) {
      if (load > 0 && load > previous.load) kinds.push('load');
      const previousReps = previous.reps.get(load);
      if (previousReps != null && set.reps > previousReps) kinds.push('reps_at_load');
      if (load > 0 && setVolume(set) > previous.volume) kinds.push('set_volume');
    }
    if (kinds.length) events.push({ date: set.date, exerciseId: id, setId: set.id, kinds });
    const next = previous ?? { load: 0, reps: new Map<number, number>(), volume: 0 };
    next.load = Math.max(next.load, load);
    next.reps.set(load, Math.max(next.reps.get(load) ?? 0, set.reps));
    next.volume = Math.max(next.volume, setVolume(set));
    best.set(id, next);
  }
  return events;
}

export function exerciseSeries(sets: LoggedSet[]) {
  const dates = [...new Set(sets.map(set => set.date))];
  return dates.map(date => {
    const day = sets.filter(set => set.date === date);
    const loaded = day.filter(set => set.weight != null && set.weight > 0);
    const strength = day.map(estimatedStrength).filter((value): value is number => value != null);
    const efforts = day.filter(set => set.rpe != null);
    const best = [...day].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || b.reps - a.reps)[0]!;
    return {
      date,
      load: loaded.length ? Math.max(...loaded.map(set => set.weight!)) : null,
      reps: Math.max(...day.map(set => set.reps)),
      totalReps: day.reduce((sum, set) => sum + set.reps, 0),
      sets: day.length,
      volume: loaded.length ? day.reduce((sum, set) => sum + setVolume(set), 0) : null,
      estimatedStrength: strength.length ? Math.max(...strength) : null,
      rpe: efforts.length ? Math.round(efforts.reduce((sum, set) => sum + set.rpe!, 0) / efforts.length * 10) / 10 : null,
      bestSet: { weight: best.weight, reps: best.reps },
      entries: day.map(set => ({ id: set.id, setNumber: set.setNumber, weight: set.weight, reps: set.reps, rpe: set.rpe })),
    };
  });
}
