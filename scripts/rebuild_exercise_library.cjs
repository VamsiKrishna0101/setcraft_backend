// Checkpointed staging only. No deletion, database writes, or live cutover.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Client}=require('pg');
const {S3Client,ListObjectsV2Command,HeadObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {mp4Info}=require('./replace_male_exercise_media.cjs');
const {normalizeName,sourceTitle,buildMatches}=require('./exercise_media_match.cjs');
require('dotenv').config({quiet:true});
const root=path.resolve('build/exercise-library-v2'),sourceRoot=path.resolve('../media-imports/lyfta-inspection');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(name,data)=>{fs.mkdirSync(root,{recursive:true});const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(data,null,2));fs.renameSync(p+'.tmp',p);};
const s3=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},maxAttempts:4});
const buckets={male:{bucket:'fitai-exercise-media',base:'https://pub-2111ee02db9e4d4396611479b3804ef3.r2.dev'},female:{bucket:'fitai-exercise-media-female',base:'https://pub-7d883b21f04e4fdab24b23d2b46ec995.r2.dev'}};
function identity(source){return normalizeName(sourceTitle(source).replace(/\bfemale\b|\bwoman\b|\bwomen\b/gi,' ').replace(/\((?:femal|fema|fem|fe|f)\.?$/i,' '));}
function validateSource(source){const u=new URL(source.url);assert.equal(u.protocol,'https:');assert.equal(u.hostname,'apilyfta.com');assert.equal(u.search,'');assert.equal(u.hash,'');assert.equal(u.username,'');assert.ok(u.pathname.startsWith('/static/GymvisualMP4/'));assert.equal(decodeURIComponent(u.pathname.split('/').at(-1)),source.filename);assert.ok(!/[\\/]/.test(source.filename));assert.ok(['male','female'].includes(source.gender));}
async function inventory(bucket){const rows=[];let token;do{const p=await s3.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));rows.push(...(p.Contents||[]).map(o=>({key:o.Key,bytes:o.Size,etag:o.ETag})));token=p.IsTruncated?p.NextContinuationToken:undefined;}while(token);return rows;}
async function backup(){
 if(fs.existsSync(path.join(root,'backup-complete.json')))return console.log('Existing backup preserved.');
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const counts={};
 for(const {tablename} of tables){const rows=(await db.query('SELECT * FROM public."'+tablename.replaceAll('"','""')+'"')).rows;save('database/'+tablename+'.json',rows);counts[tablename]=rows.length;}
 save('database/schema.json',(await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows);await db.query('COMMIT');
 for(const [gender,config] of Object.entries(buckets))save('backup-'+gender+'-objects.json',await inventory(config.bucket));
 fs.copyFileSync('prisma/schema.prisma',path.join(root,'schema.prisma.before'));fs.copyFileSync('exercises.json',path.join(root,'exercises.json.before'));fs.copyFileSync('data/exercise_catalog.app.json',path.join(root,'catalogue.json.before'));
 save('backup-complete.json',{createdAt:new Date().toISOString(),tables:counts,mediaStrategy:'Existing objects retained unchanged; versioned additions only',databaseWrites:false});console.log(JSON.stringify({backupTables:tables.length,exercises:counts.Workout,databaseWrites:false}));
 }finally{await db.end();}
}
function prepare(){
 assert.ok(fs.existsSync(path.join(root,'backup-complete.json')),'Back up first');
 const sources=read(path.join(sourceRoot,'public-exercise-media.json'));sources.forEach(validateSource);
 const raw=read(path.join(sourceRoot,'public-exercise-catalogue.json'));const byFile=new Map();for(const row of raw){const filename=decodeURIComponent((row.video_file||'').split('/').at(-1)||'');if(filename){if(!byFile.has(filename))byFile.set(filename,[]);byFile.get(filename).push(row);}}
 const existing=read(path.join(root,'database/Workout.json')),catalog=read('exercises.json');
 const matches=buildMatches(existing,catalog,sources,{validateSource});
 const mapped=new Map(matches.filter(w=>w.source).map(w=>[w.id,w.source]));
 const oldFemale=read('build/female-video-upload/exercise-mapping.json').exercises;
 const groups=new Map();for(const source of sources){const key=identity(source);assert.ok(key);if(!groups.has(key))groups.set(key,{key,id:hash('setcraft-exercise-v2:'+key).slice(0,24),name:sourceTitle(source).replace(/\s*\(female\)\s*/gi,' ').replace(/-/g,' ').replace(/\s+/g,' ').trim(),sources:[],existingIds:[],publicMetadata:[]});const group=groups.get(key);group.sources.push(source);for(const row of byFile.get(source.filename)||[])group.publicMetadata.push({...row,video_file:undefined,image_name:undefined,instructions:undefined});}
 for(const workout of existing){const source=mapped.get(workout.id);if(source)groups.get(identity(source)).existingIds.push(workout.id);}
 // Earlier confirmed female mappings are evidence, never fuzzy movement merges.
 const femaleNames=new Map(sources.filter(s=>s.gender==='female').map(s=>[s.filename,s]));
 for(const row of oldFemale.filter(w=>w.femaleVideoUrl)){const source=femaleNames.get(row.femaleSourceFilename);if(source&&!groups.get(identity(source)).existingIds.includes(row.id))groups.get(identity(source)).existingIds.push(row.id);}
 const rows=[...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));
 for(const row of rows){row.publicMetadata=[...new Map(row.publicMetadata.map(m=>[m.id,m])).values()];row.existingIds.sort();row.existing=row.existingIds.map(id=>existing.find(w=>w.id===id));row.status='STAGED';}
 const version=hash(JSON.stringify(sources.map(s=>s.url))).slice(0,12);save('plan.json',{version,sources,groups:rows});save('summary.json',{version,sourceRecords:raw.length,uniqueVideos:sources.length,male:sources.filter(s=>s.gender==='male').length,female:sources.filter(s=>s.gender==='female').length,stagedMovements:rows.length,withExistingMetadata:rows.filter(r=>r.existing.length).length,generatedInstructionsRequired:rows.filter(r=>!r.existing.length).length});console.log(JSON.stringify(read(path.join(root,'summary.json'))));
}
async function pool(items,worker,concurrency=8){let index=0,done=0;const failed=[];await Promise.all(Array.from({length:concurrency},async()=>{while(index<items.length){const item=items[index++];try{await worker(item);}catch(error){failed.push({filename:item.filename,error:error.message});}done++;if(done%100===0||done===items.length)console.log(JSON.stringify({processed:done,total:items.length,failed:failed.length}));}}));return failed;}
async function download(){
 const plan=read(path.join(root,'plan.json'));const folder=path.join(root,'videos');fs.mkdirSync(folder,{recursive:true});
 const completed=fs.existsSync(path.join(root,'downloaded.json'))?read(path.join(root,'downloaded.json')).videos:[];const ready=new Map(completed.map(v=>[v.url,v]));
 const known=new Map();for(const file of ['build/lyfta-male-fill/downloaded.json','build/female-video-upload/downloaded.json','build/male-video-replacement/downloaded.json'])if(fs.existsSync(file))for(const v of read(file).videos)if(v.file&&fs.existsSync(v.file))known.set(v.filename,v.file);
 let checkpoint=0;
 const failed=await pool(plan.sources,async source=>{
  if(ready.has(source.url)){const r=ready.get(source.url);if(fs.existsSync(r.file)&&hash(fs.readFileSync(r.file))===r.sha256)return;ready.delete(source.url);}
  const file=known.get(source.filename)||path.join(folder,source.filename);let bytes;
  if(fs.existsSync(file)){bytes=fs.readFileSync(file);mp4Info(bytes);}else{
   let error;for(let attempt=0;attempt<3;attempt++){try{const response=await fetch(source.url,{redirect:'error',signal:AbortSignal.timeout(60000)});if(response.status!==200)throw new Error('Source HTTP '+response.status);assert.match(response.headers.get('content-type')||'',/video\/mp4/);bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<32*1024*1024);mp4Info(bytes);fs.writeFileSync(file+'.part',bytes);fs.renameSync(file+'.part',file);break;}catch(e){error=e;if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));}}if(!bytes)throw error;
  }
  ready.set(source.url,{...source,file,bytes:bytes.length,sha256:hash(bytes),...mp4Info(bytes)});if(++checkpoint%25===0)save('downloaded.json',{version:plan.version,videos:[...ready.values()]});
 });save('downloaded.json',{version:plan.version,videos:[...ready.values()].sort((a,b)=>a.filename.localeCompare(b.filename))});save('unavailable.json',failed);console.log(JSON.stringify({downloaded:ready.size,failed:failed.length,bytes:[...ready.values()].reduce((s,v)=>s+v.bytes,0)}));
}
async function upload(){
 const plan=read(path.join(root,'plan.json')),downloaded=read(path.join(root,'downloaded.json')),decoded=read(path.join(root,'decoded.json'));assert.equal(plan.version,decoded.version);const valid=new Set(decoded.videos.map(v=>v.sha256));
 const known=new Map();for(const file of ['build/lyfta-male-fill/uploaded.json','build/female-video-upload/uploaded.json','build/male-video-replacement/uploaded.json'])if(fs.existsSync(file)){const d=read(file);for(const a of d.assets||d.videos||[])if(a.sha256&&a.publicUrl)known.set(a.sha256,a);}
 const assets=fs.existsSync(path.join(root,'uploaded.json'))?read(path.join(root,'uploaded.json')).assets:[];const ready=new Map(assets.map(a=>[a.url,a]));let checkedUploads=0;
 const failed=await pool(downloaded.videos,async video=>{assert.ok(valid.has(video.sha256),'Clip not decoded');const previous=ready.get(video.url);if(previous?.sha256===video.sha256&&previous.gender===video.gender&&previous.bucket===buckets[video.gender].bucket)return;ready.delete(video.url);
 const config=buckets[video.gender],old=known.get(video.sha256);let key=old?.key,publicUrl=old?.publicUrl;
 if(!publicUrl){key=`videos/library-v2-${plan.version}/${video.sha256}.mp4`;publicUrl=`${config.base}/${key}`;const bytes=fs.readFileSync(video.file);assert.equal(hash(bytes),video.sha256);await s3.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:bytes,ContentType:'video/mp4',ContentDisposition:'inline',CacheControl:'public, max-age=31536000, immutable',Metadata:{sha256:video.sha256,gender:video.gender,sourcefilename:video.filename}}));}
 const actualBucket=new URL(publicUrl).origin===buckets.female.base?buckets.female.bucket:buckets.male.bucket;
 if(!key)key=decodeURIComponent(new URL(publicUrl).pathname.slice(1));const head=await s3.send(new HeadObjectCommand({Bucket:actualBucket,Key:key}));assert.equal(head.ContentLength,video.bytes);
 const response=await fetch(publicUrl,{signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),video.sha256);const range=await fetch(publicUrl,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
 const posterFile=path.join(root,'previews',path.basename(video.file,'.mp4')+'.jpg');const poster=fs.readFileSync(posterFile);const posterKey=`images/library-v2-${plan.version}/${video.sha256}.jpg`;
 await s3.send(new PutObjectCommand({Bucket:config.bucket,Key:posterKey,Body:poster,ContentType:'image/jpeg',CacheControl:'public, max-age=31536000, immutable'}));
 const posterCheck=await fetch(`${config.base}/${posterKey}`,{signal:AbortSignal.timeout(30000)});assert.equal(posterCheck.status,200);assert.match(posterCheck.headers.get('content-type')||'',/image\/jpeg/);assert.equal(hash(Buffer.from(await posterCheck.arrayBuffer())),hash(poster));
 ready.set(video.url,{...video,key,publicUrl,posterUrl:`${config.base}/${posterKey}`,bucket:actualBucket,verifiedAt:new Date().toISOString()});if(++checkedUploads%25===0)save('uploaded.json',{version:plan.version,assets:[...ready.values()]});
 },Math.max(1,Math.min(16,Number(process.env.LIBRARY_UPLOAD_CONCURRENCY||6))));save('uploaded.json',{version:plan.version,assets:[...ready.values()]});save('upload-errors.json',failed);console.log(JSON.stringify({verifiedUploads:ready.size,failed:failed.length,liveCatalogueChanged:false}));
}
async function main(){switch(process.argv[2]){case '--backup':return backup();case '--prepare':return prepare();case '--download':return download();case '--upload':return upload();default:throw new Error('Choose --backup, --prepare, --download or --upload');}}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>s3.destroy());
module.exports={identity,validateSource};
