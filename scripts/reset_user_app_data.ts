import prisma from '../config/prisma';
import redis from '../config/redis';
import {queuePhotoDeletion, flushBodyPhotoDeletions} from '../modules/body/body_photo_storage';

const models = ['notificationJob','notificationDevice','notificationPreference','weeklyPersonalPlan','weeklyPlanRun',
  'plannerDemoWeek','workoutSetLog','workoutSession','userWorkout','workoutRoutine','workoutDay',
  'userMealPlan','userMealLog','userWaterLog','bodyAssessment','bodyScan','muscleCheckIn',
  'healthKitWorkout','healthKitSnapshot','dailyWellnessEntry','readiness','progressPreviewDay',
  'userCompanion','userPrivacyConsent','nutrition','onboarding'] as const;

async function main() {
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Pass an exact --email= address. Default mode is read-only.');
  const user = await prisma.user.findUnique({where: {email}, select: {id: true, email: true}});
  if (!user) throw new Error(`No account exists for the exact address ${email}.`);
  const counts: Record<string, number> = {};
  for (const model of models) counts[model] = await (prisma[model] as any).count({where: {userId: user.id}});
  const photos = await prisma.bodyAssessmentPhoto.findMany({where: {assessment: {userId: user.id}}});
  console.log(JSON.stringify({mode: process.argv.includes('--apply') ? 'reset' : 'read-only', email: user.email,
    records: counts, savedPhotos: photos.length, preserved: ['sign-in identity', 'verification', 'billing', 'subscription and trial entitlement']}, null, 2));
  if (!process.argv.includes('--apply')) return;
  const deleted = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id} FOR UPDATE`;
    const currentPhotos = await tx.bodyAssessmentPhoto.findMany({where: {assessment: {userId: user.id}}});
    await queuePhotoDeletion(tx, currentPhotos);
    const result: Record<string, number> = {};
    for (const model of models) result[model] = (await (tx[model] as any).deleteMany({where: {userId: user.id}})).count;
    await tx.user.update({where: {id: user.id}, data: {wearableUsage: 'UNKNOWN'}});
    return result;
  }, {timeout: 30000});
  await flushBodyPhotoDeletions();
  const keys = await redis.keys(`*${user.id}*`);
  if (keys.length) await redis.del(...keys);
  const remaining: Record<string, number> = {};
  for (const model of models) remaining[model] = await (prisma[model] as any).count({where: {userId: user.id}});
  const identity = await prisma.user.findUnique({where: {id: user.id}, select: {email: true}});
  const pendingPhotoDeletions = photos.filter(p => p.objectKey && p.bucket);
  const queued = pendingPhotoDeletions.length ? await prisma.bodyPhotoDeletion.count({where: {
    OR: pendingPhotoDeletions.map(p => ({bucket: p.bucket!, objectKey: p.objectKey!})),
  }}) : 0;
  console.log(JSON.stringify({email, deleted, remaining, signInPreserved: identity?.email === email,
    photoDeletionsPending: queued, cacheKeysCleared: keys.length}, null, 2));
  if (Object.values(remaining).some(count => count !== 0)) throw new Error('Some records remain; inspect before continuing.');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;}).finally(() => prisma.$disconnect());
