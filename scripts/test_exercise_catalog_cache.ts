import assert from 'node:assert/strict';
import { cachedExercisePage, invalidateExercisePageCache, exercisePageRevisionKey } from '../utils/exercise_catalog_cache';

async function main() {
  const data = new Map<string, any>();
  const client = {} as any;
  let unavailable = false, loads = 0;
  client.mget = async (...keys:string[]) => { if(unavailable) throw Error('offline'); return keys.map(key=>data.get(key) ?? null); };
  client.set = async (key:string, value:any, options?:any) => {
    if(unavailable) throw Error('offline');
    if(key !== exercisePageRevisionKey) assert.equal(options.ex,120);
    data.set(key,value); return 'OK';
  };
  const cached = <T>(parts:unknown[], load:()=>Promise<T>) => cachedExercisePage(parts,load,client);
  const invalidate = () => invalidateExercisePageCache(client);
  const load = async () => ({count:++loads});
  const male = ['en','male','chest'], female = ['en','female','chest'];
  assert.deepEqual(await cached(male,load),{count:1});
  assert.deepEqual(await cached(male,load),{count:1});
  assert.deepEqual(await cached(female,load),{count:2});
  assert.deepEqual(await cached(['fr','male','chest'],load),{count:3});
  await invalidate();
  assert.deepEqual(await cached(male,load),{count:4});
  let release!:()=>void; const held = new Promise<void>(resolve=>release=resolve);
  const delayed = cached(['en','male','row'],async()=>{await held;return {count:-1};});
  await new Promise(resolve=>setImmediate(resolve));
  await invalidate(); release(); await delayed;
  assert.deepEqual(await cached(['en','male','row'],load),{count:5});
  // A concurrent identical miss shares one database request.
  let calls = 0;
  const same = await Promise.all([1,2,3].map(()=>cached(['de','female','curl'],async()=>{
    calls++; await new Promise(resolve=>setImmediate(resolve)); return {value:1};
  })));
  assert.equal(calls,1);assert.equal(same.length,3);
  unavailable = true;
  assert.deepEqual(await cached(male,load),{count:6});
  unavailable = false;
  await assert.rejects(cached(['bad'],async()=>{throw Error('db failed');}));
  assert.equal(await cached(['bad'],async()=>true),true);
  console.log('Exercise page cache checks passed: hits, gender/language separation, TTL, catalog invalidation, in-flight edit safety, single-flight, outage fallback and failed-query recovery. No external writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
