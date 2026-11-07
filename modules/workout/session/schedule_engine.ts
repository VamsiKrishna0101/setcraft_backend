import { addDays } from '../../../graphworkflow/common/types';

export type ScheduleMove = { workoutId: string; name: string; fromDate: string; toDate: string | null; reason?: string };
export type PendingWorkout = { id: string; date: string; name: string };

export function shiftPendingWorkouts(pending: PendingWorkout[], available: string[], skipOnly = false): ScheduleMove[] {
  const rows = [...pending].sort((a, b) => a.date.localeCompare(b.date));
  if (skipOnly) return rows.slice(0, 1).map(row => ({workoutId: row.id, name: row.name, fromDate: row.date, toDate: null, reason: 'You chose to skip this workout.'}));
  const dates = [...new Set(available)].sort();
  let previousOriginal: string | undefined;
  let previousTarget: string | undefined;
  return rows.map(row => {
    let minimum = addDays(row.date, 1);
    if (previousOriginal && previousTarget) {
      const gap = Math.round((Date.parse(`${row.date}T12:00:00Z`) - Date.parse(`${previousOriginal}T12:00:00Z`)) / 86400000);
      const afterPrevious = addDays(previousTarget, gap);
      if (afterPrevious > minimum) minimum = afterPrevious;
    }
    const target = dates.find(date => date >= minimum) ?? null;
    if (target) dates.splice(dates.indexOf(target), 1);
    previousOriginal = row.date;
    if (target) previousTarget = target;
    return {workoutId: row.id, name: row.name, fromDate: row.date, toDate: target,
      ...(target ? {} : {reason: 'No available training date remains this week.'})};
  });
}
