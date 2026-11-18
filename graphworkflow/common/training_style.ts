import { Profile, Region } from './types';

export function recommendedSplit(profile: Profile, days: number) {
  const limitedHome = profile.location === 'HOME' &&
    !profile.equipmentIds.some(id => !['bodyweight_only', 'yoga_mat'].includes(id)) &&
    !profile.equipment.some(item => !/bodyweight|none|other/i.test(item));
  if (profile.experience === 'BEGINNER' && days <= 3) return 'FULL_BODY';
  if (limitedHome && profile.minutes < 30) return 'FULL_BODY';
  if (days === 6 && profile.experience !== 'BEGINNER' && profile.minutes >= 40 &&
      ['BUILD_MUSCLE', 'GET_STRONGER'].includes(profile.goal)) return 'PUSH_PULL_LEGS';
  return 'UPPER_LOWER';
}

export function resolvedSplit(profile: Profile, days: number) {
  return !profile.trainingSplit || profile.trainingSplit === 'AUTO'
    ? recommendedSplit(profile, days) : profile.trainingSplit;
}

// Every split except full body and custom trains two muscle groups per day,
// rotating through these pairs and continuing across weeks.
export const ROTATION: Region[][] = [
  ['chest', 'triceps'],
  ['back', 'biceps'],
  ['legs', 'shoulders'],
];

export const usesRotation = (split: string) => split !== 'FULL_BODY' && split !== 'CUSTOM';

export const MAX_SESSION_EXERCISES = 6;

/** Rotation group a trained day belongs to, judged by its main (first) region. */
export function rotationGroupOf(region: Region | undefined) {
  return region ? ROTATION.findIndex(group => group.includes(region)) : -1;
}

/**
 * Where the rotation continues: after the last completed day of the previous
 * plan. With nothing completed, the user repeats where that plan started.
 */
export function nextRotation(
  days: Array<{ date: string; mainRegion?: Region }>,
  completed: (date: string) => boolean,
) {
  const trained = days
    .filter(day => rotationGroupOf(day.mainRegion) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!trained.length) return undefined;
  const last = trained.filter(day => completed(day.date)).at(-1);
  if (!last) return rotationGroupOf(trained[0]!.mainRegion);
  return (rotationGroupOf(last.mainRegion) + 1) % ROTATION.length;
}

// Shared with the app's onboarding preview fixture; schedules use ROTATION.
export function focusedGroups(days: number): Region[][] {
  if (days === 2) return [['chest', 'shoulders', 'triceps'], ['back', 'legs', 'biceps', 'core']];
  if (days === 3) return [['chest', 'shoulders', 'triceps'], ['back', 'biceps'], ['legs', 'core']];
  if (days === 4) return [['chest', 'triceps'], ['back', 'biceps'], ['legs', 'core'], ['shoulders']];
  if (days === 5) return [['chest', 'triceps'], ['back', 'biceps'], ['legs'], ['shoulders'], ['core']];
  return [['chest'], ['back'], ['legs'], ['shoulders'], ['biceps', 'triceps'], ['core']];
}
