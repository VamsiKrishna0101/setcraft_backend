import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { Difficulty, TrainingLocation } from '@prisma/client';
import { contentLocale, APP_LANGUAGES } from '../utils/app_locale';

const languages = [...new Set(APP_LANGUAGES.map(contentLocale))];
function validCatalogueMedia(media: unknown): boolean {
  if (typeof media !== 'string') return false;
  const validPath = /^(images|videos)\/[\w.-]+(?:\/[\w.-]+)*\.(jpg|png|webp|gif|mp4)$/;
  if (validPath.test(media)) return true;
  try {
    const url = new URL(media);
    const configuredOrigins = [process.env.EXERCISE_VIDEO_BASE_URL, process.env.EXERCISE_GIF_BASE_URL]
      .filter((base): base is string => !!base)
      .map(base => new URL(base).origin);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && configuredOrigins.includes(url.origin) &&
      validPath.test(url.pathname.slice(1));
  } catch { return false; }
}
export function planCatalogue(rows: Array<{exerciseCode:string;name:string}>, existing: Array<{id:string;exerciseCode:string|null;name:string}>) {
  const byCode = new Map<string, typeof existing[number]>();
  for (const item of existing) if (item.exerciseCode) {
    if (byCode.has(item.exerciseCode)) throw new Error(`Duplicate existing catalogue code ${item.exerciseCode}; import stopped without deletion.`);
    byCode.set(item.exerciseCode, item);
  }
  const byName = new Map<string, Array<typeof existing[number]>>();
  for (const item of existing) {
    const key = item.name.toLowerCase();
    byName.set(key, [...(byName.get(key) || []), item]);
  }
  return rows.map(row => {
    const named = byName.get(row.name.toLowerCase()) || [];
    const match = byCode.get(row.exerciseCode) || (named.length === 1 && !named[0].exerciseCode ? named[0] : undefined);
    // Keep both records when a legacy/custom exercise owns the same name.
    // Only the canonical storage name needs disambiguation; translated display
    // names and every existing exercise ID/plan link remain intact.
    let name = row.name, variation = 0;
    while ((byName.get(name.toLowerCase()) || []).some(item => item.id !== match?.id)) {
      variation++;
      name = `${row.name} [${row.exerciseCode}${variation > 1 ? `:${variation}` : ''}]`;
    }
    byName.set(name.toLowerCase(), [{id:match?.id || `new:${row.exerciseCode}`,exerciseCode:row.exerciseCode,name}]);
    return { row: { ...row, name }, id: match?.id };
  });
}
export function catalogueRows(raw: any[]) {
  const codes = new Set<string>(), names = new Map<string, number>();
  return raw.map(row => {
    const code = String(row.id).padStart(4, '0');
    if (!/^\d{4}$/.test(code) || codes.has(code)) throw new Error(`Invalid/duplicate exercise code: ${code}`);
    codes.add(code);
    for (const locale of languages) {
      if (!row.names?.[locale]?.trim() || !Array.isArray(row.instruction_steps?.[locale]) ||
          !row.instruction_steps[locale].length || row.instruction_steps[locale].some((s: any) => typeof s !== 'string' || !s.trim())) {
        throw new Error(`Missing translation: ${code}/${locale}`);
      }
    }
    // A missing verified animation is intentionally null; never restore a GIF
    // or reject a valid catalogue merely because this movement has no MP4 yet.
    for (const media of [row.image, ...(row.gif_url === null ? [] : [row.gif_url])]) {
      if (!validCatalogueMedia(media)) throw new Error(`Invalid media path: ${code}`);
    }
    const capital = (s: string) => s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
    const base = capital(String(row.name).trim());
    const occurrence = (names.get(base.toLowerCase()) || 0) + 1;
    names.set(base.toLowerCase(), occurrence);
    return { exerciseCode: code, name: occurrence === 1 ? base : `${base} (Variation ${occurrence})`,
      description: row.instructions.en, category: capital(row.category), bodyPart: capital(row.body_part),
      target: capital(row.target), secondaryMuscles: row.secondary_muscles.map(capital),
      equipment: capital(row.equipment), instructions: row.instruction_steps.en,
      namesByLang: Object.fromEntries(languages.map(l => [l, row.names[l]])),
      instructionsByLang: Object.fromEntries(languages.map(l => [l, row.instructions[l]])),
      instructionStepsByLang: Object.fromEntries(languages.map(l => [l, row.instruction_steps[l]])),
      videoUrl: row.gif_url, thumbnailUrl: row.image, mediaId: row.media_id,
      muscleGroup: capital(row.muscle_group), attribution: row.attribution };
  });
}
export async function importCatalogue(dryRun = false) {
  if (await prisma.workout.findFirst({where:{catalogStatus:'READY',catalogVersion:{not:null}},select:{id:true}})) {
    throw new Error('The versioned exercise library is active. Use its staging/publish tools; the legacy importer cannot overwrite it.');
  }
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../exercises.json'), 'utf8'));
  const prepared = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/exercise_catalog.app.json'), 'utf8'));
  if (prepared.length !== source.length) throw new Error(`Preparation incomplete: ${prepared.length}/${source.length}. No database changes made.`);
  const rows = catalogueRows(prepared);
  const before = await Promise.all([prisma.userWorkout.count(), prisma.userWorkoutItem.count(), prisma.workoutSetLog.count()]);
  const originalIds = (await prisma.workout.findMany({select:{id:true}})).map(row => row.id);
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74621324)`;
    const existing = await tx.workout.findMany({ select: { id: true, exerciseCode: true, name: true } });
    const plan = planCatalogue(rows, existing);
    let created = 0, updated = 0;
    for (const item of plan) {
      const row = item.row as typeof rows[number];
      if (item.id) {
        if (!dryRun) await tx.workout.update({ where: { id: item.id }, data: row });
        updated++;
      } else {
        if (!dryRun) await tx.workout.create({ data: { ...row, duration: 0, caloriesBurnEstimate: null, tempo: null, restSeconds: null,
          difficulty: /snatch|muscle.up|handstand/i.test(row.name) ? Difficulty.ADVANCED :
            /barbell|cable|smith/i.test(row.equipment) ? Difficulty.INTERMEDIATE : Difficulty.BEGINNER,
          trainingLocation: /body.weight|band/i.test(row.equipment) ? TrainingLocation.HOME :
            /running|walking/i.test(row.name) ? TrainingLocation.OUTDOORS : TrainingLocation.GYM } });
        created++;
      }
    }
    return { created, updated, total: rows.length, dryRun,
      disambiguatedNames: plan.filter((item,index) => item.row.name !== rows[index].name).length };
  }, { timeout: 600000, maxWait: 20000 });
  const after = await Promise.all([prisma.userWorkout.count(), prisma.userWorkoutItem.count(), prisma.workoutSetLog.count()]);
  const afterIds = new Set((await prisma.workout.findMany({select:{id:true}})).map(row => row.id));
  console.log(JSON.stringify({ ...result, preservedExistingExerciseIds:originalIds.every(id => afterIds.has(id)),
    planAndHistoryCountsBefore: before, planAndHistoryCountsAfter: after }));
  if (!dryRun) {
    try {
      for (const pattern of ['exercises:*', 'exercise:*', 'userworkout:*', 'home:*']) {
        const keys = await redis.keys(pattern);
        for (let i = 0; i < keys.length; i += 100) await redis.del(...keys.slice(i, i + 100));
      }
    } catch { console.warn('Catalogue saved; Redis cache refresh unavailable.'); }
  }
}
if (require.main === module) importCatalogue(process.argv.includes('--dry-run'))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
