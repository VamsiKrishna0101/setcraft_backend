const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const LANGUAGES=['en','de','fr','sv','no','da','nl','es','it'];
const LEVELS=['BEGINNER','INTERMEDIATE','ADVANCED'];
function stableUuid(key){const b=crypto.createHash('sha256').update('setcraft-library-v2:'+key).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
function validateContent(group,content){
 assert.equal(content.id,group.id);assert.ok(content.name?.trim());assert.ok(LEVELS.includes(content.difficulty));
 assert.ok(['HIGH','REVIEW'].includes(content.confidence));assert.ok(Array.isArray(content.primaryMuscles)&&content.primaryMuscles.length);
 assert.ok(Array.isArray(content.secondaryMuscles));assert.ok(content.equipment?.trim());assert.ok(content.difficultyReason?.trim());
 const count=content.translations?.en?.steps?.length;assert.ok(count>=3&&count<=7);
 for(const language of LANGUAGES){const value=content.translations?.[language];assert.ok(value?.name?.trim(),`Missing name ${group.id}/${language}`);assert.equal(value.steps?.length,count,`Step mismatch ${group.id}/${language}`);assert.ok(value.steps.every(s=>typeof s==='string'&&s.trim().length>4));}
 assert.ok(['GYM','HOME','OUTDOORS'].includes(content.trainingLocation));
 assert.ok(['weight_reps','bodyweight_reps','assisted_reps','duration','distance_duration'].includes(content.exerciseType));
 assert.ok(!/\.(mp4|gif)|https?:\/\//i.test(content.name));
}
function buildRecord(group,content,assets,version){
 validateContent(group,content);
 const matched=group.sources.map(s=>assets.get(s.url)).filter(Boolean);
 const variant=gender=>{
  const candidates=matched.filter(a=>a.gender===gender).sort((a,b)=>a.filename.localeCompare(b.filename));
  // Prefer the original primary source when its exact checksum was retained.
  const original=candidates.find(a=>group.existing.some(e=>e.videoUrl===a.publicUrl));
  const selected=original||candidates[0];if(!selected)return null;const aspectRatio=selected.width/selected.height;assert.ok(Number.isFinite(aspectRatio)&&aspectRatio>=.5&&aspectRatio<=2.5,'Unverified source dimensions');return {url:selected.publicUrl,posterUrl:selected.posterUrl,sha256:selected.sha256,aspectRatio};
 };
 const male=variant('male'),female=variant('female');assert.ok(male||female,'No verified MP4 for '+group.name);
 const validUrl=value=>{const u=new URL(value);assert.ok(u.protocol==='https:'&&u.pathname.endsWith('.mp4')&&!u.search&&!u.hash&&!u.username&&!u.password);assert.ok(['pub-2111ee02db9e4d4396611479b3804ef3.r2.dev','pub-7d883b21f04e4fdab24b23d2b46ec995.r2.dev'].includes(u.hostname));};
 for(const v of [male,female])if(v)validUrl(v.url);
 const existing=[...group.existing].sort((a,b)=>Number(a.exerciseCode?.startsWith('today-preview:'))-Number(b.exerciseCode?.startsWith('today-preview:'))||a.id.localeCompare(b.id))[0];
 const primary=male||female;
 let exerciseType=content.exerciseType;
 if(content.equipment==='Body Weight'&&exerciseType==='weight_reps')exerciseType='bodyweight_reps';
 const allTimed=group.publicMetadata.length&&group.publicMetadata.every(r=>['duration','distance_duration','steps_duration'].includes(r.exercise_type));
 const holdReason=content.confidence==='REVIEW'?content.reviewReason||'Uncertain movement identity':allTimed&&['weight_reps','bodyweight_reps','assisted_reps'].includes(exerciseType)?'Timed source conflicts with a rep-based classification':null;
 const namesByLang=Object.fromEntries(LANGUAGES.map(l=>[l,content.translations[l].name]));
 const steps=Object.fromEntries(LANGUAGES.map(l=>[l,content.translations[l].steps]));
 const difficulty=/\b(planche|muscle.?up|snatch|clean and jerk|handstand push|one arm pull.?up|one arm chin.?up)\b/i.test(content.name)?'ADVANCED':content.difficulty;
 return {id:existing?.id||stableUuid(group.key),exerciseCode:existing?.exerciseCode||`SC2:${group.id}`,name:content.name,
  description:steps.en.join(' '),category:content.movementType==='cardio'?'Cardio':content.movementType==='mobility'?'Mobility':'Strength',
  duration:0,bodyPart:content.bodyPart,target:content.primaryMuscles[0],secondaryMuscles:content.secondaryMuscles,equipment:content.equipment,instructions:steps.en,
  difficulty,trainingLocation:content.trainingLocation,videoUrl:primary.url,thumbnailUrl:primary.posterUrl,mediaVariants:{...(male?{male}:{}),...(female?{female}:{})},
  muscleGroup:content.primaryMuscles.join(', '),mediaId:`setcraft-library-v2:${group.id}`,attribution:'Exercise demonstration © Gym Visual',
  namesByLang,instructionsByLang:Object.fromEntries(LANGUAGES.map(l=>[l,steps[l].join(' ')])),instructionStepsByLang:steps,
  caloriesBurnEstimate:null,tempo:null,restSeconds:null,tips:[],catalogVersion:version,catalogStatus:holdReason?'STAGED':'READY',
  coachingMetadata:{exerciseType,primaryMuscles:content.primaryMuscles,secondaryMuscles:content.secondaryMuscles,movementPattern:content.movementPattern,movementType:content.movementType,
   requiresBench:content.requiresBench,limitations:content.limitations,difficultyReason:content.difficultyReason,confidence:holdReason?'REVIEW':'HIGH',reviewReason:holdReason,
   sourceKeys:group.sources.map(s=>s.filename),contentHash:crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex'),provenance:content.provenance},legacyIds:group.existingIds};
}
module.exports={LANGUAGES,validateContent,buildRecord,stableUuid};
