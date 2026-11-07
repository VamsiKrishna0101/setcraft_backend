// Emergency metadata rollback. Never delete new exercises: a user may have logged them.
const fs=require('node:fs'),path=require('node:path');const {Client}=require('pg');const {Redis}=require('@upstash/redis');require('dotenv').config({quiet:true});
const root=path.resolve('build/exercise-library-v2');
async function main(){
 const before=JSON.parse(fs.readFileSync(path.join(root,'database-immediately-before-publish.json'),'utf8'));
 const published=JSON.parse(fs.readFileSync(path.join(root,'published.json'),'utf8'));
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();
 try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74621324)');
  await db.query('UPDATE "Workout" SET "catalogStatus"=\'ARCHIVED\' WHERE "catalogVersion"=$1',[published.version]);
  for(const record of before){const {id,...row}=record;const keys=Object.keys(row);const values=keys.map(k=>typeof row[k]==='object'&&row[k]!==null&&!Array.isArray(row[k])?JSON.stringify(row[k]):row[k]);await db.query('UPDATE "Workout" SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')+' WHERE id=$'+(keys.length+1),[...values,id]);}
  await db.query('COMMIT');fs.copyFileSync(path.join(root,'fitness-ui-immediately-before-publish.json'),'data/fitness_ui.json');
  const report={restoredExercises:before.length,newExerciseRowsRetained:true,userDataChanged:false,rolledBackAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'rollback.json'),JSON.stringify(report,null,2));
  try{const redis=new Redis({url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN});for(const pattern of ['exercises:*','exercise:*','home:*','training:*','userworkout:*']){const keys=await redis.keys(pattern);for(let i=0;i<keys.length;i+=100)await redis.del(...keys.slice(i,i+100));}}catch{}
  console.log(JSON.stringify(report));
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
