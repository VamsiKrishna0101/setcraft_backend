import prisma from '../config/prisma';
import { dateInZone } from '../graphworkflow/common/types';
import { getTrainingMap } from '../modules/heatmap/training_map_service';
import { getProgressOverview } from '../modules/progress/progress_service';
import { readFile, writeFile } from 'node:fs/promises';

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'vklvl0101@gmail.com' }, select: { id: true } });
  const date = dateInZone('Asia/Kolkata');
  const [map, progress] = await Promise.all([
    getTrainingMap(user.id, date, 330, 'en', 'week'),
    getProgressOverview(user.id, { date, period: 'all', utcOffsetMinutes: 330 }, 'en'),
  ]);
  const results = {
    date, mapSummary: map.summary,
    strengthColours: map.regions.map(region => ({ muscle: region.id, tier: region.strength.tier,
      provisional: region.strength.provisional, sets: region.completedSets })),
    measurementsWithTrends: progress.body.metrics.filter(metric => metric.series.some(series => series.points.length > 1)).length,
    nutritionDays: progress.wellness.nutrition.length,
    sleepDays: progress.wellness.recovery.filter(day => day.sleep != null).length,
    recentSessionCards: progress.recentSessions.length,
  };
  if (!map.regions.some(region => region.strength.tier > 0) || results.measurementsWithTrends < 10
    || results.nutritionDays < 30 || results.sleepDays < 30) throw new Error('Demo view readback failed');
  const receiptPath = 'seed-results/account-month-demo.json';
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await writeFile(receiptPath, JSON.stringify({ ...receipt, verifiedViews: results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
