import 'dotenv/config';
import prisma from '../config/prisma';
import {readBodyPhoto} from '../modules/body/body_photo_storage';
import {decodePhotos} from '../modules/body/body_engine';
import {extractPhotoGeometry, stopBodyPoseWorker} from '../modules/body/body_pose';
import {geometrySchema} from '../modules/body/physique_dashboard';
import {readFile} from 'node:fs/promises';
import {getPlannedPhysiqueMap} from '../modules/heatmap/planned_physique_service';

// Read-only diagnostic for the account whose scan repair was requested.
// No photo bytes, credentials or storage keys are logged or written to disk.
async function main() {
  const email = process.env.BODY_REVIEW_TEST_EMAIL;
  if (!email) throw new Error('Set BODY_REVIEW_TEST_EMAIL to the consenting test account.');
  const user = await prisma.user.findUnique({where: {email}, select: {id: true}});
  if (!user) throw new Error('Requested test account was not found.');
  if (process.argv.includes('--weeks')) {
    for (const date of ['2026-10-19', '2026-10-12', '2026-10-05']) {
      try {
        const result = await getPlannedPhysiqueMap(user.id, date, 330);
        console.log(JSON.stringify({date, weekStart: result.weekStart, weekEnd: result.weekEnd,
          status: result.status, days: result.workouts.length}));
      } catch (error: any) {
        console.log(JSON.stringify({errorType: error.name, code: error.code, meta: error.meta,
          reason: error.message?.split('\n').at(-1)}));
        process.exitCode = 1;
        return;
      }
    }
    return;
  }
  const entries = await prisma.bodyAssessment.findMany({
    where: {userId: user.id, method: 'photo_review'}, orderBy: {createdAt: 'desc'}, take: 3,
    include: {photos: true},
  });
  for (const entry of entries) {
    const report = (entry.quality as any)?.physiqueAssessment;
    console.log(JSON.stringify({recordedDate: entry.recordedDate, savedViews: entry.photos.map(p => p.view),
      geometry: report?.dashboard?.geometry, metrics: report?.dashboard?.metrics?.map((m: any) => ({id: m.id, source: m.source, available: typeof m.value === 'number'}))}));
  }
  if (process.argv.includes('--local-front')) {
    const bytes = await readFile('bodyimages/front.jpeg');
    const local = decodePhotos([{view: 'front', mimeType: 'image/jpeg', base64: bytes.toString('base64')}]);
    console.log(JSON.stringify({providedLocalFront: geometrySchema.parse(await extractPhotoGeometry(local)), providerUpload: false, databaseWrites: false}));
    return;
  }
  const front = entries.flatMap(e => e.photos).find(p => p.view === 'front');
  if (!front) {
    console.log('No retained front photo. Report-only scans cannot be reprocessed without a new photo.');
    return;
  }
  const bytes = await readBodyPhoto(front);
  console.log(JSON.stringify({retainedPhotoBytes: bytes.length, mimeType: front.mimeType}));
  const photos = decodePhotos([{view: 'front', mimeType: front.mimeType, base64: bytes.toString('base64')}]);
  try {
    const geometry = geometrySchema.parse(await extractPhotoGeometry(photos));
    console.log(JSON.stringify({localRecheck: geometry, providerUpload: false, databaseWrites: false}));
  } catch (error) {
    console.log(JSON.stringify({localWorkerError: error instanceof Error ? error.message : 'Unknown geometry error', providerUpload: false, databaseWrites: false}));
  }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;})
  .finally(() => {stopBodyPoseWorker(); return prisma.$disconnect();});
