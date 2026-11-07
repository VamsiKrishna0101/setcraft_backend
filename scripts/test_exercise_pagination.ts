import 'dotenv/config';
import assert from 'node:assert/strict';
import express from 'express';
import prisma from '../config/prisma';
import { handleGetAllExercises } from '../modules/workout/workout_controller';
import { Prisma } from '@prisma/client';
import { exerciseCacheRedis } from '../config/redis';
import { cachedExercisePage } from '../utils/exercise_catalog_cache';
import { randomUUID } from 'node:crypto';
import { exercisePageQuery, exercisePageWhere } from '../modules/workout/exercise_catalog';
import { fitnessTerm } from '../utils/fitness_locale';
import { preferredExerciseMedia, exercisePresentation } from '../utils/exercise_media';
import { getAllExercises } from '../modules/workout/workout_service';

async function main() {
  const app = express();
  // Isolated handler checks; production route still uses its existing auth middleware.
  app.get('/exercises', (req, res, next) => exercisePresentation.run({gender: req.header('X-Test-Profile') ?? 'MALE'}, () => handleGetAllExercises(req, res, next)));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/exercises`;
  const get = async (query: Record<string, string>, language = 'en', profile = 'MALE') => {
    const response = await fetch(`${base}?${new URLSearchParams(query)}`, { headers: { 'Accept-Language': language, 'X-Test-Profile': profile } });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  try {
    const active = { catalogStatus: { notIn: ['STAGED', 'ARCHIVED'] } };
    const variants = await prisma.workout.findMany({where:active, select:{id:true,name:true,bodyPart:true,equipment:true,mediaVariants:true}});
    const eligible = variants.filter(row => preferredExerciseMedia(row.mediaVariants, 'male'));
    const count = (body: string, equipment?: string) => eligible.filter(row => row.bodyPart === body && (!equipment || row.equipment === equipment)).length;
    const started = performance.now();
    const first = await get({ page: '1' });
    const firstMs = performance.now() - started;
    assert.equal(first.pagination.total, eligible.length);
    assert.equal(first.data.length, Math.min(24, first.pagination.total));
    assert(first.data.every((row:any) => row.url && row.thumbnailUrl && row.url === row.mediaVariants.male.url));
    assert(first.filters.bodyParts.length > 0 && first.filters.equipment.length > 0);
    const repeatStarted = performance.now();
    const repeated = await get({page:'1'});
    const repeatMs = performance.now()-repeatStarted;
    assert.deepEqual(repeated,first,'Cached response preserves the full page and count');
    const second = await get({ page: '2' });
    assert(second.data.every((row: any) => !first.data.some((e: any) => e.id === row.id)), 'Pages do not repeat exercises');
    const sample = first.data[0];
    const filtered = await get({ page: '1', bodyPart: sample.bodyPart, equipment: sample.equipment });
    assert(filtered.data.every((e: any) => e.bodyPart === sample.bodyPart && e.equipment === sample.equipment));
    assert.equal(filtered.pagination.total, count(sample.bodyPart, sample.equipment));
    const chestCount = count('Chest');
    const chestSearch = await get({page:'1',search:'chest'});
    assert(chestSearch.pagination.total >= chestCount && chestCount > 24,
      'Chest searches the full active catalogue, not the current page or exercise names alone');
    const chest = await get({page:'1',search:'chest',bodyPart:' chest '});
    assert.equal(chest.pagination.total,chestCount,'Body filters ignore letter case and surrounding spaces');
    assert.equal(chest.data.length,24);
    const nextChest = await get({page:'2',search:'chest',bodyPart:'Chest'});
    assert.equal(nextChest.pagination.total,chestCount);
    assert(nextChest.data.every((row:any)=>row.bodyPart==='Chest' && !chest.data.some((e:any)=>e.id===row.id)));
    const dumbbellChest = await get({page:'1',search:'chest',bodyPart:'CHEST',equipment:'dumbbell'});
    assert.equal(dumbbellChest.pagination.total,count('Chest', 'Dumbbell'));
    assert(dumbbellChest.data.every((row:any)=>row.bodyPart==='Chest' && row.equipment==='Dumbbell'));
    for (const gender of ['male', 'female']) {
      const expected = variants.filter(row => preferredExerciseMedia(row.mediaVariants, gender));
      const profile = await get({page:'1'}, 'en', gender.toUpperCase());
      assert.equal(profile.pagination.total, expected.length, 'Default profile filters before counting and paging');
      assert(profile.data.every((row:any) => row.url && row.url === row.mediaVariants[gender].url && row.thumbnailUrl));
      assert.deepEqual(profile.filters.bodyParts.map((o:any) => o.value).sort(), [...new Set(expected.map(row => row.bodyPart))].filter(Boolean).sort());
      assert.deepEqual(profile.filters.equipment.map((o:any) => o.value).sort(), [...new Set(expected.map(row => row.equipment))].filter(Boolean).sort());
      const legacy = await exercisePresentation.run({gender:gender.toUpperCase()}, () => getAllExercises());
      assert.equal(legacy.length, expected.length, 'Non-paged add/replace pickers also exclude unavailable demos');
      assert(legacy.every(row => row.url === (row.mediaVariants as any)[gender].url));
      const demos = await get({page:'1',mediaGender:gender}, 'en', gender === 'female' ? 'MALE' : 'FEMALE');
      assert.equal(demos.pagination.total,expected.length,'Demo filter total matches available verified variants');
      assert(demos.data.every((row:any) => row.url === (row.mediaVariants as any)[gender].url));
      assert(demos.data.every((row:any) => row.thumbnailUrl === ((row.mediaVariants as any)[gender].posterUrl ?? null)));
      const combined = await get({page:'1',mediaGender:gender,bodyPart:'Chest',search:'chest'});
      assert(combined.data.every((row:any) => row.bodyPart === 'Chest' && row.url === row.mediaVariants[gender].url));
      if (demos.pagination.totalPages > 1) {
        const next = await get({page:'2',mediaGender:gender});
        assert.equal(next.pagination.total,demos.pagination.total);
        assert(next.data.every((row:any) => row.url === row.mediaVariants[gender].url && !demos.data.some((e:any)=>e.id===row.id)));
      }
    }
    const german = await get({ page: '1' }, 'de');
    const search = await get({ page: '1', search: german.data[0].name }, 'de');
    assert(search.data.some((e: any) => e.id === german.data[0].id), 'Translated names are searchable');
    const translatedBody = await get({ page: '1', pageSize: '50', search: fitnessTerm(sample.bodyPart, 'fr') }, 'fr');
    assert(translatedBody.data.some((e: any) => e.id === sample.id), 'Translated anatomy labels are searchable');
    const literal = await get({ page: '1', search: '%_\\' });
    assert.equal(literal.pagination.total, 0, 'SQL wildcards remain literal');
    const injected = await get({ page: '1', search: "' OR TRUE --" });
    assert.equal(injected.pagination.total, 0);
    const beyond = await get({ page: String(first.pagination.totalPages + 1) });
    assert.equal(beyond.data.length, 0);
    for (const query of ['page=0', 'page=1&pageSize=1000', 'page=abc', 'page=1&difficulty=FAKE', 'page=1&mediaGender=unknown']) {
      assert.equal((await fetch(`${base}?${query}`)).status, 400);
    }
    assert.equal(exercisePageQuery.safeParse({ page: ['1', '2'] }).success, false);
    assert.equal(exercisePageQuery.safeParse({ page: '1', bodyPart: { x: 'bad' } }).success, false);
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'Workout'`;
    const plans = [];
    for (const filter of [{search:'chest'}, {bodyPart:'Chest',equipment:'Dumbbell'}, {mediaGender:'male',search:'chest'}]) {
      const where = exercisePageWhere(exercisePageQuery.parse(filter));
      const result = await prisma.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id","name" FROM "Workout" WHERE ${where} ORDER BY "name","id" LIMIT 24`);
      const plan=result[0]['QUERY PLAN'][0];
      plans.push({filter,executionMs:plan['Execution Time'],plan:plan.Plan});
    }
    console.log('Existing exercise indexes:',indexes.map(row=>row.indexname).join(', '));
    console.log('Read-only query plans:',JSON.stringify(plans));
    let probeLoads=0;
    const probe=['catalog-cache-audit',randomUUID()];
    const probeLoad=async()=>({publicCatalog:true,load:++probeLoads});
    await cachedExercisePage(probe,probeLoad);
    await cachedExercisePage(probe,probeLoad);
    console.log('First page ms:',firstMs.toFixed(0),'Repeated page ms:',repeatMs.toFixed(0),'Redis reachable:',await exerciseCacheRedis.ping().then(()=>true,()=>false),'Verified Redis hit:',probeLoads===1);
    assert(indexes.some(row => row.indexname === 'Workout_catalog_search_trgm_idx'));
    assert(indexes.some(row => row.indexname === 'Workout_name_id_idx'));
    const pageBytes = Buffer.byteLength(JSON.stringify(first));
    console.log(`Exercise pagination/filter/search checks passed. ${first.pagination.total} active exercises; chest search ${chestSearch.pagination.total}, chest filter ${chestCount}, dumbbell chest ${dumbbellChest.pagination.total}; first page ${pageBytes} bytes, ${firstMs.toFixed(0)} ms locally. No database writes.`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
