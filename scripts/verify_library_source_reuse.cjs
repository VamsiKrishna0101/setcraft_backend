// Verify that reused clips from the earlier host match the current public source bytes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve('build/exercise-library-v2');const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const data=JSON.parse(fs.readFileSync(path.join(root,'downloaded.json'),'utf8'));
const videos=data.videos.filter(v=>/hevy-inspection/i.test(v.file));
let cursor=0,checked=0;const changed=[],failed=[];
async function worker(){while(cursor<videos.length){const v=videos[cursor++];try{
 const response=await fetch(v.url,{redirect:'error',signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const actual=sha(bytes);
 if(actual!==v.sha256){const file=path.join(root,'videos',v.filename);fs.writeFileSync(file,bytes);const {mp4Info}=require('./replace_male_exercise_media.cjs');Object.assign(v,{file,sha256:actual,bytes:bytes.length,...mp4Info(bytes)});changed.push(v.filename);}
 checked++;if(checked%100===0)console.log(JSON.stringify({checked,total:videos.length,changed:changed.length}));
 }catch(e){failed.push({filename:v.filename,error:e.message});}}}
async function main(){await Promise.all(Array.from({length:8},worker));if(changed.length){fs.writeFileSync(path.join(root,'downloaded.json.tmp'),JSON.stringify(data,null,2));fs.renameSync(path.join(root,'downloaded.json.tmp'),path.join(root,'downloaded.json'));}
 const report={checked,total:videos.length,changed,failed,verifiedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'source-reuse-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checked,total:videos.length,changed:changed.length,failed:failed.length}));if(failed.length)process.exitCode=1;}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
