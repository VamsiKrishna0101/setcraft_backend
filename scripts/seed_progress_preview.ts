import 'dotenv/config';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma';
import { mapExercise, MUSCLE_IDS } from '../modules/heatmap/training_map_engine';
import { PreviewPayload } from '../modules/progress/preview/preview_data';
import { shiftDate } from '../modules/progress/progress_range';
import { invalidateProgress } from '../modules/progress/progress_cache';

function uuid(value: string) {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  const email = process.argv[2];
  if (email !== 'vklvl0101@gmail.com') throw new Error('This preview seed is scoped to the requested account.');
  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true, onboarding: { select: { weight: true } } } });
  if (!owner) throw new Error('Requested account not found.');
  const catalog = await prisma.workout.findMany({ select: {
    id: true, name: true, target: true, muscleGroup: true, bodyPart: true, secondaryMuscles: true, equipment: true, category: true,
  } });
  const selected = MUSCLE_IDS.map(id => {
    const candidates = catalog.filter(exercise => mapExercise(exercise).primary.includes(id) && !/stretch|cardio/i.test(`${exercise.category} ${exercise.name}`));
    const preferred = candidates.find(exercise => /barbell|dumbbell|cable|machine|body weight/i.test(exercise.equipment));
    const exercise = preferred ?? candidates[0];
    if (!exercise) throw new Error(`No catalogue exercise for ${id}.`);
    return { muscle: id, exercise };
  });
  const end = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const start = shiftDate(end, -29);
  const baseWeight = owner.onboarding?.weight ?? 80;
  let sessions = 0;
  const rows: Array<{ date: string; data: PreviewPayload }> = [];
  for (let index = 0; index < 30; index++) {
    const date = shiftDate(start, index);
    const active = [0, 2, 4, 5].includes(index % 7) || index === 29;
    const block = Math.floor(index / 7);
    const data: PreviewPayload = {
      session: active ? { id: uuid(`${owner.id}:${date}:session`), name: 'Full-body strength', durationSeconds: 2200 + sessions % 5 * 180 } : null,
      sets: [],
      body: index % 3 === 0 || index === 29 ? {
        weightKg: Math.round((baseWeight - index * .025 + Math.sin(index) * .15) * 10) / 10,
        chestCm: Math.round((98 + index * .025) * 10) / 10,
        waistCm: Math.round((91 - index * .04) * 10) / 10,
        hipsCm: Math.round((100 - index * .015) * 10) / 10,
        leftArmCm: Math.round((32 + index * .015) * 10) / 10,
        rightArmCm: Math.round((32.2 + index * .015) * 10) / 10,
        leftThighCm: Math.round((55 + index * .02) * 10) / 10,
        rightThighCm: Math.round((55.3 + index * .02) * 10) / 10,
        leftCalfCm: Math.round((36 + index * .008) * 10) / 10,
        rightCalfCm: Math.round((36.1 + index * .008) * 10) / 10,
        neckCm: 37,
      } : {},
      recovery: { recovery: 60 + (index * 7 % 31), sleep: Math.round((6.5 + index % 6 * .27) * 10) / 10, hrv: 48 + index % 8 * 3, rhr: 55 + index % 5 },
      nutrition: { calories: 2450 + index % 7 * 65, protein: 140 + index % 6 * 7, carbs: 290 + index % 5 * 15, fat: 65 + index % 5 * 3, water: 2100 + index % 5 * 250 },
    };
    data.nutrition.calories = data.nutrition.protein * 4 + data.nutrition.carbs * 4 + data.nutrition.fat * 9;
    if (active) {
      const group = sessions % 3;
      const exercises = selected.filter((_, i) => i % 3 === group);
      for (const [position, { exercise }] of exercises.entries()) {
        const bodyweight = /body\s*weight|assisted|band/i.test(exercise.equipment);
        const weight = bodyweight ? null : /dumbbell|kettlebell/i.test(exercise.equipment) ? 10 + position * 2 + block : 30 + position * 5 + block * 2.5;
        for (let set = 1; set <= 3; set++) data.sets.push({
          id: uuid(`${owner.id}:${date}:${exercise.id}:${set}`),
          itemId: uuid(`${owner.id}:${date}:${exercise.id}`), exerciseId: exercise.id,
          setNumber: set, weight, reps: 11 - set + block % 2, rpe: 7 + set % 2,
        });
      }
      sessions++;
    }
    rows.push({ date, data });
  }
  await prisma.$transaction(async tx => {
    await tx.progressPreviewDay.deleteMany({ where: { userId: owner.id } });
    await tx.progressPreviewDay.createMany({ data: rows.map(row => ({ userId: owner.id, date: row.date, data: JSON.parse(JSON.stringify(row.data)) })) });
  });
  await invalidateProgress(owner.id);
  console.log(`Saved 30 preview days (${start} to ${end}), ${sessions} sessions and ${rows.reduce((sum, row) => sum + row.data.sets.length, 0)} sets for the requested account. Real records were untouched.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
