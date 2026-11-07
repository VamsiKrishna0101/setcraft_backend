import assert from 'node:assert/strict';
import prisma from '../config/prisma';
import {getBodyHistory, updatePhotoReadings} from '../modules/body/body_service';

async function main() {
  const findMany = prisma.bodyAssessment.findMany, findFirst = prisma.bodyAssessment.findFirst,
    updateMany = prisma.bodyAssessment.updateMany, findProfile = prisma.onboarding.findUnique;
  const rows = Array.from({length: 14}, (_, i) => ({id: `real-scan-${i}`, userId: 'member',
    method: 'photo_review', status: 'SAVED', quality: {}, metrics: {}, observations: [],
    recordedDate: `2026-10-${String(20-i).padStart(2, '0')}`,
    createdAt: new Date(`2026-10-${String(20-i).padStart(2, '0')}T10:00:00Z`),
    updatedAt: new Date('2026-10-20T10:00:00Z'),
    photos: i === 11 || i === 12 ? [{id: `p-${i}`, view: 'front', mimeType: 'image/png'}] : []}));
  const readings = {source: 'smart_scale', recordedDate: '2026-10-20', bodyFatPct: 22};
  try {
    prisma.bodyAssessment.findMany = (async () => rows) as unknown as typeof findMany;
    const history = await getBodyHistory('member', {page: 1});
    assert.equal(history.total, 14);
    assert.equal(history.records.length, 12);
    assert.equal(history.comparisonBaselines[0]?.id, 'real-scan-12', 'Matching earlier scan is found on another page');
    prisma.bodyAssessment.findFirst = (async () => null) as unknown as typeof findFirst;
    await assert.rejects(() => updatePhotoReadings('other-member', 'private', '2026-10-20T10:00:00Z', readings), /not found/);
    prisma.bodyAssessment.findFirst = (async () => rows[0]) as unknown as typeof findFirst;
    await assert.rejects(() => updatePhotoReadings('member', rows[0]!.id, '2026-10-20T10:00:00Z', {...readings, recordedDate: '2026-10-21'}), /date/);
    prisma.onboarding.findUnique = (async () => ({weight: 75})) as unknown as typeof findProfile;
    await assert.rejects(() => updatePhotoReadings('member', rows[0]!.id, '2026-10-20T10:00:00Z', {...readings, muscleMassKg: 80}), /less than/);
    prisma.bodyAssessment.updateMany = (async args => {
      assert.equal(args.where?.userId, 'member');
      assert.equal(args.where?.id, rows[0]!.id);
      assert.ok(args.where?.updatedAt instanceof Date);
      return {count: 0};
    }) as typeof updateMany;
    await assert.rejects(() => updatePhotoReadings('member', rows[0]!.id, '2026-10-20T10:00:00Z', readings), /changed/);
  } finally {
    prisma.bodyAssessment.findMany = findMany; prisma.bodyAssessment.findFirst = findFirst;
    prisma.bodyAssessment.updateMany = updateMany; prisma.onboarding.findUnique = findProfile;
    await prisma.$disconnect();
  }
  console.log('History cross-page comparison, ownership, reading dates, units and optimistic updates passed. No DB writes.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
