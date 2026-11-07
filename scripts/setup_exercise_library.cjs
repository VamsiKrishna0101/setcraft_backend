const fs=require('node:fs');
const {Client}=require('pg');
require('dotenv').config({quiet:true});
async function main(){
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();
 try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74621324)');
 await db.query(fs.readFileSync('prisma/migrations/20261023133000_exercise_library_v2/migration.sql','utf8'));
 const rows=(await db.query('SELECT count(*)::int AS count FROM "Workout"')).rows;
 await db.query('COMMIT');console.log(JSON.stringify({additiveSchemaReady:true,existingExercises:rows[0].count,deletedRecords:0}));
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{await db.end();}
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
