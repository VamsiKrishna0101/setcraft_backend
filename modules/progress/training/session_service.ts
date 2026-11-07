import { inRange, progressRange } from '../progress_range';
import { ListQuery, ProgressError } from '../progress_types';
import { recordEvents, setVolume } from './exercise_engine';
import { exerciseList } from './exercise_service';
import { trainingData, TrainingData } from './training_data';

export function sessionRows(data: TrainingData, locale: string, sessions = data.sessions) {
  const records = recordEvents(data.sets);
  return sessions.map(session => {
    const ids = new Set(session.userWorkout.items.map(item => item.id));
    const sets = data.sets.filter(set => ids.has(set.userWorkoutItemId) && set.date === session.date);
    const exerciseIds = [...new Set(sets.map(set => set.workoutItem.workout.id))];
    const setIds = new Set(sets.map(set => set.id));
    return {
      id: session.id,
      date: session.date,
      name: session.name,
      status: session.status,
      durationSeconds: session.durationSeconds,
      sets: sets.length,
      records: records.filter(record => setIds.has(record.setId)).length,
      volume: sets.some(set => set.weight != null && set.weight > 0) ? Math.round(sets.reduce((sum, set) => sum + setVolume(set), 0)) : null,
      exercises: exerciseIds.map(id => {
        const logs = sets.filter(set => set.workoutItem.workout.id === id);
        const exercise = exerciseList({ ...data, sets: logs }, { date: session.date, period: 'all', utcOffsetMinutes: 0 }, locale)[0]!;
        return {
          id,
          name: exercise.name,
          entries: logs.map(set => ({
            weight: set.weight,
            reps: set.reps,
            rpe: set.rpe,
            setNumber: set.setNumber,
          })),
        };
      }),
    };
  });
}

export async function getSessions(owner: string, query: ListQuery, locale: string) {
  const data = await trainingData(owner, query.period === 'custom' ? query.end! : query.date, query.dataset);
  const earliest = [...data.sessions.map(row => row.date), ...data.sets.map(set => set.date)].sort()[0];
  const range = progressRange(query, earliest);
  const rows = data.sessions.filter(session => inRange(session.date, range));
  const start = query.cursor ? rows.findIndex(row => row.id === query.cursor) + 1 : 0;
  if (query.cursor && start === 0) throw new ProgressError('Invalid page cursor');
  const items = sessionRows(data, locale, rows.slice(start, start + query.limit));
  return { items, nextCursor: start + items.length < rows.length ? items.at(-1)!.id : null };
}
