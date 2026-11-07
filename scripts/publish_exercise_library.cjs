// Activation is separate from preparation, guarded by validated complete manifests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg');const {Redis}=require('@upstash/redis');
const {LANGUAGES,buildRecord,stableUuid}=require('./library_catalogue.cjs');require('dotenv').config({quiet:true});
const root=path.resolve('build/exercise-library-v2');const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const save=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2));
function assemble(){
 const plan=read('plan.json'),uploads=read('uploaded.json'),decoded=read('decoded.json');assert.equal(uploads.version,plan.version);assert.equal(decoded.version,plan.version);
 const assets=new Map(uploads.assets.map(a=>[a.url,a]));assert.equal(assets.size,plan.sources.length,'All source media must be verified before cutover');
 const decodedHashes=new Set(decoded.videos.map(v=>v.sha256));assert.ok(uploads.assets.every(a=>decodedHashes.has(a.sha256)));
 const reuse=read('source-reuse-verification.json');assert.equal(reuse.failed.length,0);assert.equal(reuse.checked,reuse.total);
 const downloads=read('downloaded.json');const actualHashes=new Map(downloads.videos.map(v=>[v.url,v.sha256]));assert.ok(uploads.assets.every(a=>actualHashes.get(a.url)===a.sha256),'Source bytes changed after upload');
 const audit=read('metadata-audit.json');assert.equal(audit.version,plan.version);assert.equal(audit.counts.prepared,plan.groups.length);assert.equal(audit.counts.missing,0);
 const records=plan.groups.map(g=>{const content=read('content/'+g.id+'.json'),hold=audit.holds[g.id];const row=buildRecord(g,hold?{...content,confidence:'REVIEW',reviewReason:hold.reasons.join('; ')}:content,assets,plan.version);if(row.catalogStatus==='STAGED'&&g.existing.length){row.id=stableUuid(g.key+':review');row.exerciseCode='SC2:review:'+g.id;}return row;});
 const terms=read('fitness-ui.ready.json');for(const row of records)for(const language of LANGUAGES.filter(l=>l!=='en'))for(const label of [row.bodyPart,row.target,row.equipment,row.difficulty,...row.secondaryMuscles])assert.ok(terms[language]?.[label]?.trim(),`Missing translated label ${label}/${language}`);
 assert.equal(new Set(records.map(r=>r.id)).size,records.length,'Stable exercise IDs collide');
 const existing=read('database/Workout.json'),usedNames=new Set(existing.map(r=>r.name.toLowerCase()));
 for(const r of records){const old=existing.find(e=>e.id===r.id);if(old){r.name=old.name;continue;}let name=r.name,index=0;while(usedNames.has(name.toLowerCase())){index++;name=r.name+' ['+r.exerciseCode+(index>1?':'+index:'')+']';}r.name=name;usedNames.add(name.toLowerCase());}
 save('ready-catalogue.json',records);save('review-needed.json',records.filter(r=>r.catalogStatus!=='READY').map(r=>({id:r.id,name:r.name,reason:r.coachingMetadata.reviewReason})));
 const summary={version:plan.version,total:records.length,ready:records.filter(r=>r.catalogStatus==='READY').length,heldForReview:records.filter(r=>r.catalogStatus!=='READY').length,male:records.filter(r=>r.mediaVariants.male).length,female:records.filter(r=>r.mediaVariants.female).length,both:records.filter(r=>r.mediaVariants.male&&r.mediaVariants.female).length,languages:LANGUAGES,difficulties:Object.fromEntries(['BEGINNER','INTERMEDIATE','ADVANCED'].map(d=>[d,records.filter(r=>r.difficulty===d&&r.catalogStatus==='READY').length]))};save('ready-summary.json',summary);console.log(JSON.stringify(summary));
}
async function counts(db){const out={};for(const table of ['User','UserWorkout','UserWorkoutItem','WorkoutSetLog','WorkoutSession','WeeklyPersonalPlan']){try{out[table]=(await db.query('SELECT count(*)::int AS count FROM "'+table+'"')).rows[0].count;}catch(e){if(e.code!=='42P01')throw e;}}return out;}
async function publish(dryRun=false){
 const records=read('ready-catalogue.json'),summary=read('ready-summary.json');assert.equal(records.length,summary.total);assert.ok(summary.ready>1300,'Replacement must improve coverage before cutover');
 const previousTerms=fs.readFileSync('data/fitness_ui.json','utf8');let termsReplaced=false,committed=false;
 fs.writeFileSync(path.join(root,'fitness-ui-immediately-before-publish.json'),previousTerms);
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query('SELECT pg_advisory_xact_lock(74621324)');
  const before=await counts(db),existing=(await db.query('SELECT * FROM "Workout" ORDER BY id')).rows;save('database-immediately-before-publish.json',existing);
  const ready=records.filter(r=>r.catalogStatus==='READY');
  const used=new Set(records.map(r=>r.id)),previousIds=new Set(existing.map(e=>e.id));
  const created=records.filter(r=>!previousIds.has(r.id)).length,updated=records.length-created;
  const payload=records.map(({legacyIds,...row})=>row);const keys=Object.keys(payload[0]);
  const columns=keys.map(k=>'"'+k+'"').join(',');
  const assignments=keys.filter(k=>k!=='id').map(k=>'"'+k+'"=EXCLUDED."'+k+'"').join(',');
  // PostgreSQL handles enums, JSON and text arrays with the table's real types.
  // Batching avoids thousands of network round trips while preserving one transaction.
  for(let offset=0;offset<payload.length;offset+=100){await db.query(
   'INSERT INTO "Workout" ('+columns+',"createdAt","updatedAt") SELECT '+columns+',NOW(),NOW() FROM jsonb_populate_recordset(NULL::"Workout",$1::jsonb) WHERE TRUE ON CONFLICT (id) DO UPDATE SET '+assignments+',"updatedAt"=NOW()',
   [JSON.stringify(payload.slice(offset,offset+100))]);}
  // Archive old catalogue entries from browsing/recommendations; keep their IDs and all references.
  const backedUpIds=read('database/Workout.json').map(r=>r.id);
  await db.query('UPDATE "Workout" SET "catalogStatus"=\'ARCHIVED\' WHERE id=ANY($1::text[]) AND NOT (id=ANY($2::text[]))',[backedUpIds,[...used]]);
  const after=await counts(db);assert.deepEqual(after,before,'User/history/plan counts changed');
  const rows=(await db.query('SELECT id,"videoUrl","catalogStatus" FROM "Workout"')).rows;assert.ok(existing.every(e=>rows.some(r=>r.id===e.id)),'An existing ID was removed');assert.equal(rows.filter(r=>r.catalogStatus==='READY').length,ready.length);assert.ok(rows.filter(r=>r.catalogStatus==='READY').every(r=>/\.mp4$/.test(r.videoUrl)));
  if(dryRun){await db.query('ROLLBACK');const result={validated:true,rolledBack:true,created,updated,activeExercises:ready.length,stagedExercises:records.length-ready.length,originalIdsPreserved:true,historyCountsUnchanged:true};save('dry-run-verification.json',result);console.log(JSON.stringify(result));return;}
  fs.writeFileSync('data/fitness_ui.json.library-tmp',JSON.stringify(read('fitness-ui.ready.json'),null,2));fs.renameSync('data/fitness_ui.json.library-tmp','data/fitness_ui.json');termsReplaced=true;
  await db.query('COMMIT');committed=true;save('published.json',{version:summary.version,created,updated,activeExercises:ready.length,totalStored:rows.length,existingIdsPreserved:true,historyCounts:after,publishedAt:new Date().toISOString()});
  try{const redis=new Redis({url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN});for(const pattern of ['exercises:*','exercise:*','home:*','training:*','userworkout:*']){const keys=await redis.keys(pattern);for(let i=0;i<keys.length;i+=100)await redis.del(...keys.slice(i,i+100));}}catch{save('cache-refresh-needed.json',{version:summary.version});}
  console.log(JSON.stringify(read('published.json')));
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(termsReplaced&&!committed)fs.writeFileSync('data/fitness_ui.json',previousTerms);throw e;}finally{await db.end();}
}
async function main(){if(process.argv[2]==='--assemble')return assemble();if(process.argv[2]==='--publish')return publish(process.argv.includes('--dry-run'));throw new Error('Choose --assemble or --publish');}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={assemble};
