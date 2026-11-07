import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import prisma from '../config/prisma';
import { exercisePresentation } from '../utils/exercise_media';
import { catalogExerciseSelect, formatExercise, getExerciseById } from '../modules/workout/workout_service';
import { getExercisePage, exercisePageQuery } from '../modules/workout/exercise_catalog';
import { curatedExercise } from '../graphworkflow/common/catalog';
import { localizedExercise } from '../utils/fitness_locale';
const languages=['en','de','fr','sv','no','da','nl','es','it'];
async function main(){
 const folder='build/exercise-library-v2/';
 const release=JSON.parse(fs.readFileSync(folder+'published.json','utf8'));
 const uploads=JSON.parse(fs.readFileSync(folder+'uploaded.json','utf8'));
 const verifiedUrls=new Set(uploads.assets.map((a:any)=>a.publicUrl));
 const previous=JSON.parse(fs.readFileSync(folder+'database-immediately-before-publish.json','utf8'));
 const rows=await prisma.workout.findMany();
 const byId=new Map(rows.map(r=>[r.id,r]));
 assert(previous.every((r:any)=>byId.has(r.id)),'Every original exercise ID remains');
 const active=rows.filter(r=>r.catalogStatus==='READY');assert.equal(active.length,release.activeExercises);
 for(const row of active){assert(verifiedUrls.has(row.videoUrl));assert(row.thumbnailUrl?.endsWith('.jpg'));assert(!row.videoUrl?.includes('.gif'));
  for(const l of languages){assert((row.namesByLang as any)?.[l]);assert((row.instructionStepsByLang as any)?.[l]?.length>=3);}
  const media=row.mediaVariants as any;for(const variant of [media?.male,media?.female])if(variant)assert(verifiedUrls.has(variant.url));
  assert.equal((row.coachingMetadata as any)?.confidence,'HIGH');
 }
 const sample=active.find(r=>(r.mediaVariants as any)?.male&&(r.mediaVariants as any)?.female);assert(sample,'At least one paired presentation');
 const [female,male]=await Promise.all([
  exercisePresentation.run({gender:'FEMALE'},()=>getExerciseById(sample.id,'de')),
  exercisePresentation.run({gender:'MALE'},()=>getExerciseById(sample.id,'de')),
 ]);
 assert.equal(female.url,(sample.mediaVariants as any).female.url);assert.equal(male.url,(sample.mediaVariants as any).male.url);
 assert.equal(female.id,male.id);assert.equal(female.difficulty,male.difficulty);assert.equal(female.contentLanguage,'de');
 assert.equal('coachingMetadata' in female,false);
 const query=exercisePageQuery.parse({page:1,pageSize:24});
 const first=await getExercisePage(query,'en',catalogExerciseSelect,formatExercise);
 assert(first.data.every((r:any)=>r.catalogStatus!=='ARCHIVED'&&r.catalogStatus!=='STAGED'));
 for(const level of ['BEGINNER','INTERMEDIATE','ADVANCED']){
  const page=await getExercisePage(exercisePageQuery.parse({page:1,difficulty:level}),'en',catalogExerciseSelect,formatExercise);
  assert(page.data.length>0);assert(page.data.every((r:any)=>r.difficulty===level));
 }
 for(const l of languages){const item:Record<string,any>=localizedExercise(formatExercise(sample),l);assert.equal(item.contentLanguage,l);assert.equal(item.id,sample.id);assert(item.instructions.length>=3);}
 const candidates=active.map(r=>curatedExercise(r as any)).filter(Boolean);
 assert(candidates.length>100);assert(candidates.some(c=>c!.difficulty==='BEGINNER'));assert(candidates.some(c=>c!.difficulty==='ADVANCED'));
 const result={activeExercises:active.length,allOriginalIdsPreserved:true,activeGifLinks:0,verifiedMediaMappings:true,pairedMediaSelection:true,
  translations:languages,filterAndPagination:true,weightedRepPlanningCandidates:candidates.length,historyCounts:release.historyCounts,verifiedAt:new Date().toISOString()};
 fs.writeFileSync(folder+'release-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
