import { MUSCLE_IDS, MUSCLE_LABELS } from '../../heatmap/training_map_engine';
import { inRange, monday, percentChange, ProgressRange, shiftDate } from '../progress_range';
import { recordEvents, setVolume } from './exercise_engine';
import { TrainingData } from './training_data';

export function trainingSummary(data: TrainingData, range: ProgressRange) {
  const sets = data.sets.filter(set => inRange(set.date, range));
  const previous = data.sets.filter(set => inRange(set.date, { start: range.previousStart, end: range.previousEnd }));
  const completed = data.sessions.filter(session => session.status === 'COMPLETED' && inRange(session.date, range));
  const previousSessions = data.sessions.filter(session => {
    return session.status === 'COMPLETED' && inRange(session.date, {
      start: range.previousStart,
      end: range.previousEnd,
    });
  });
  const events = recordEvents(data.sets).filter(event => inRange(event.date, range));
  const setsById = new Map(sets.map(set => [set.id, set]));
  const highlightedExercises = new Set<string>();
  const personalBests = [...events].reverse().flatMap(event => {
    const set = setsById.get(event.setId);
    if (!set || highlightedExercises.has(event.exerciseId)) return [];
    highlightedExercises.add(event.exerciseId);
    return [{
      exerciseId: event.exerciseId,
      date: event.date,
      weight: set.weight,
      reps: set.reps,
      kinds: event.kinds,
    }];
  }).slice(0, 3);
  const weeks = [];
  for (let date = monday(range.start); date <= range.end; date = shiftDate(date, 7)) {
    const end = shiftDate(date, 6);
    const logs = sets.filter(set => set.date >= date && set.date <= end);
    weeks.push({
      date,
      sets: logs.length,
      volume: Math.round(logs.reduce((sum, set) => sum + setVolume(set), 0)),
      workouts: completed.filter(session => session.date >= date && session.date <= end).length,
      partial: date < range.start || end > range.end,
    });
  }
  const activityDates = [...new Set([...sets.map(set => set.date), ...completed.map(session => session.date)])].sort();
  const muscles = MUSCLE_IDS.map(id => {
    const direct = sets.filter(set => data.mappings.get(set.workoutItem.workout.id)?.primary.includes(id));
    const assisting = sets.filter(set => data.mappings.get(set.workoutItem.workout.id)?.secondary.includes(id));
    const earlier = previous.filter(set => data.mappings.get(set.workoutItem.workout.id)?.primary.includes(id));
    const dates = [...new Set(direct.map(set => set.date))].sort();
    return {
      id,
      label: MUSCLE_LABELS[id],
      directSets: direct.length,
      assistingSets: assisting.length,
      previousSets: range.comparable ? earlier.length : null,
      trainingDays: dates.length,
      lastTrained: dates.at(-1) ?? null,
    };
  });
  return {
    summary: {
      workouts: completed.length,
      sets: sets.length,
      volume: Math.round(sets.reduce((sum, set) => sum + setVolume(set), 0)),
      records: events.length,
      trainingDays: activityDates.length,
      workoutChange: range.comparable ? completed.length - previousSessions.length : null,
      previousWorkouts: range.comparable ? previousSessions.length : null,
      hasPreviousTraining: data.sets.some(set => set.date < range.start) || data.sessions.some(session => session.status === 'COMPLETED' && session.date < range.start),
      setsChange: range.comparable ? percentChange(sets.length, previous.length) : null,
    },
    weeks,
    personalBests,
    activity: activityDates.map(date => ({
      date,
      sets: sets.filter(set => set.date === date).length,
      completed: completed.some(session => session.date === date),
    })),
    muscles,
    unmappedSets: sets.filter(set => !data.mappings.get(set.workoutItem.workout.id)?.primary.length).length,
  };
}
