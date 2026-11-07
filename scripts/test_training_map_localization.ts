import 'dotenv/config';
import assert from 'node:assert/strict';
import { buildTrainingMap, Exercise } from '../modules/heatmap/training_map_engine';
import { localizeTrainingMap } from '../modules/heatmap/training_map_locale';
const exercise: Exercise = { id: 'bench', name: 'Bench press', target: 'chest', muscleGroup: 'chest', bodyPart: 'chest', secondaryMuscles: ['triceps'] };
const map = buildTrainingMap({date: '2026-10-08', utcOffsetMinutes: 0,
  sets: [{id:'set',itemId:'item',setNumber:1,date:'2026-10-08',weight:40,reps:8,exercise}],
  planned: [{itemId:'item', targetSets:3,dayOfWeek:'THURSDAY',exercise}],checkIns:[],focusMuscles:[],limitations:[]});
const original = JSON.stringify(map);
for (const locale of ['de','de-CH','fr','sv','no','da','nl','es','it']) {
  const local = localizeTrainingMap(map, locale, new Map([['Bench press','Localized bench']]));
  assert.deepEqual(local.summary,map.summary);
  assert.deepEqual(local.regions.map(({id,completedSets,targetSets,dueSets,assistingSets,status,trend}) => ({id,completedSets,targetSets,dueSets,assistingSets,status,trend})),
    map.regions.map(({id,completedSets,targetSets,dueSets,assistingSets,status,trend}) => ({id,completedSets,targetSets,dueSets,assistingSets,status,trend})));
  const chest=local.regions.find(region=>region.id==='chest')!;
  assert.notEqual(chest.insight, map.regions[0]!.insight);
  assert.match(chest.insight,/2/);
  assert.equal(chest.trendExercise,'Localized bench');
  assert.equal(chest.sessions[0]!.exercises[0],'Localized bench');
  assert.equal(chest.nextExercises[0]!.name,'Localized bench');
  assert.notEqual(local.countingMethod,map.countingMethod);
}
assert.equal(JSON.stringify(map),original);
console.log('Training-map language checks passed; canonical counts and input remain unchanged. No database writes.');
