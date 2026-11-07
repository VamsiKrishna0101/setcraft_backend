import { Profile, Region } from './types';

export function recommendedSplit(profile: Profile, days: number) {
  const limitedHome = profile.location === 'HOME' &&
    !profile.equipmentIds.some(id => !['bodyweight_only', 'yoga_mat'].includes(id)) &&
    !profile.equipment.some(item => !/bodyweight|none|other/i.test(item));
  if (profile.experience === 'BEGINNER' && days <= 3) return 'FULL_BODY';
  if (days <= 3 || (limitedHome && profile.minutes < 30)) return 'FULL_BODY';
  if (days === 6 && profile.experience !== 'BEGINNER' && profile.minutes >= 40 &&
      ['BUILD_MUSCLE', 'GET_STRONGER'].includes(profile.goal)) return 'PUSH_PULL_LEGS';
  return 'UPPER_LOWER';
}

export function resolvedSplit(profile: Profile, days: number) {
  return !profile.trainingSplit || profile.trainingSplit === 'AUTO'
    ? recommendedSplit(profile, days) : profile.trainingSplit;
}

// Explicit choices remain independent of experience; dose/eligibility are checked later.
export function focusedGroups(days: number): Region[][] {
  if (days === 2) return [['chest', 'shoulders', 'triceps'], ['back', 'legs', 'biceps', 'core']];
  if (days === 3) return [['chest', 'shoulders', 'triceps'], ['back', 'biceps'], ['legs', 'core']];
  if (days === 4) return [['chest', 'triceps'], ['back', 'biceps'], ['legs', 'core'], ['shoulders']];
  if (days === 5) return [['chest', 'triceps'], ['back', 'biceps'], ['legs'], ['shoulders'], ['core']];
  return [['chest'], ['back'], ['legs'], ['shoulders'], ['biceps', 'triceps'], ['core']];
}
