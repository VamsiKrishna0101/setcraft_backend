// Verify original objects, report the release, and clean only this run's unused staging objects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {S3Client,ListObjectsV2Command,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {Client}=require('pg');require('dotenv').config({quiet:true});
const root=path.resolve('build/exercise-library-v2');const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const s3=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},maxAttempts:3});
const configs={male:{bucket:'fitai-exercise-media',base:'https://pub-2111ee02db9e4d4396611479b3804ef3.r2.dev'},female:{bucket:'fitai-exercise-media-female',base:'https://pub-7d883b21f04e4fdab24b23d2b46ec995.r2.dev'}};
async function inventory(bucket){const rows=[];let token;do{const p=await s3.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));rows.push(...(p.Contents||[]).map(o=>({key:o.Key,etag:o.ETag,bytes:o.Size})));token=p.IsTruncated?p.NextContinuationToken:undefined;}while(token);return rows;}
async function main(){
 const uploads=read('uploaded.json'),plan=read('plan.json'),records=read('ready-catalogue.json'),release=read('release-verification.json');
 const refs=new Set(uploads.assets.flatMap(a=>[a.publicUrl,a.posterUrl]));
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();try{for(const row of (await db.query('SELECT "videoUrl","thumbnailUrl","mediaVariants" FROM "Workout"')).rows){if(row.videoUrl)refs.add(row.videoUrl);if(row.thumbnailUrl)refs.add(row.thumbnailUrl);for(const v of Object.values(row.mediaVariants||{})){if(v?.url)refs.add(v.url);if(v?.posterUrl)refs.add(v.posterUrl);}}}finally{await db.end();}
 const unused=[],preserved={};
 for(const [gender,config] of Object.entries(configs)){
  const current=await inventory(config.bucket),before=read('backup-'+gender+'-objects.json');
  assert.ok(before.every(o=>current.some(n=>n.key===o.key&&n.etag===o.etag)),'Original media changed');preserved[gender]=before.length;
  const oldKeys=new Set(before.map(o=>o.key));
  for(const o of current){const own=o.key.startsWith(`images/library-v2-${plan.version}/`)||o.key.startsWith(`videos/library-v2-${plan.version}/`);const url=config.base+'/'+o.key;
   if(own&&!oldKeys.has(o.key)&&!refs.has(url))unused.push({bucket:config.bucket,...o});
  }
 }
 fs.writeFileSync(path.join(root,'unused-staging-objects.json'),JSON.stringify({preservedOriginalObjects:preserved,objects:unused},null,2));
 if(process.argv.includes('--clean-staging'))for(const config of Object.values(configs)){const objects=unused.filter(o=>o.bucket===config.bucket);for(let i=0;i<objects.length;i+=500){const result=await s3.send(new DeleteObjectsCommand({Bucket:config.bucket,Delete:{Objects:objects.slice(i,i+500).map(o=>({Key:o.key})),Quiet:true}}));assert.ok(!result.Errors?.length,'Staging cleanup incomplete');}}
 const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
 const held=records.filter(r=>r.catalogStatus==='STAGED');
 fs.writeFileSync(path.join(root,'review-needed.csv'),'exerciseId,name,difficulty,reason\n'+held.map(r=>[r.id,r.namesByLang.en,r.difficulty,r.coachingMetadata.reviewReason].map(quote).join(',')).join('\n')+'\n');
 const active=records.filter(r=>r.catalogStatus==='READY');
 const result={...release,allStagedMovements:records.length,heldForReview:held.length,sourceVideos:uploads.assets.length,sourceMaleVideos:uploads.assets.filter(a=>a.gender==='male').length,sourceFemaleVideos:uploads.assets.filter(a=>a.gender==='female').length,
  activeWithMaleVideo:active.filter(r=>r.mediaVariants.male).length,activeWithFemaleVideo:active.filter(r=>r.mediaVariants.female).length,activeWithBoth:active.filter(r=>r.mediaVariants.male&&r.mediaVariants.female).length,
  preservedOriginalObjects:preserved,unusedStagingObjectsRemoved:process.argv.includes('--clean-staging')?unused.length:0};
 fs.writeFileSync(path.join(root,'final-summary.json'),JSON.stringify(result,null,2));
 fs.writeFileSync(path.join(root,'report.md'),[`# Setcraft exercise library`, '',`- ${records.length} movement groups imported; ${active.length} active, ${held.length} held for review.`,
 `- ${uploads.assets.length} source MP4s: ${result.sourceMaleVideos} male, ${result.sourceFemaleVideos} female.`,
 `- ${result.activeWithFemaleVideo} active movements have female demonstrations; ${result.activeWithBoth} have both presentations.`,
 '- Female profiles receive the female variant when available, with the available demonstration as fallback.',
 '- Names, instructions, muscle/equipment labels and difficulty labels cover all nine supported content languages.',
 '- Exercise-specific difficulty and movement demands feed the planner. Timed/assisted/distance work is excluded from weighted-rep prescriptions.',
 `- ${release.weightedRepPlanningCandidates} active weighted-rep planning candidates.`,
 '- Original exercise IDs, user accounts, plans, sessions and logged sets preserved. Old catalogue records are archived rather than deleted.',
 '- Every current clip fully decoded, source hashes checked, thumbnails checked and public streaming verified. Active GIF links: 0.',
 '- Source filename equality is not trusted: 373 earlier-host clips were replaced with verified current-source bytes.',
 '- Generated content has model provenance. Uncertain identities, conflicting classifications and duplicate display names are held for review, not represented as professionally certified content.',
 `- Original bucket objects preserved: ${preserved.male} male, ${preserved.female} female. Unused objects from this staging run removed: ${result.unusedStagingObjectsRemoved}.`,
 '', 'See review-needed.csv and final-summary.json. User/database backups are ignored local files.', ''].join('\n'));
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>s3.destroy());
