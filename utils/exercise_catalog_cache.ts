import { createHash, randomUUID } from 'node:crypto';
import { exerciseCacheRedis } from '../config/redis';

export const exercisePageRevisionKey = 'exercise-pages:revision';
const pending = new Map<string, Promise<unknown>>();
type Entry<T> = { revision: string | null; value: T };
export interface ExercisePageCacheStore {
  mget(...keys:string[]): Promise<unknown[]>;
  set(key:string, value:unknown, options?:{ex:number}): Promise<unknown>;
}

export async function cachedExercisePage<T>(parts: unknown[], load: () => Promise<T>, store: ExercisePageCacheStore = exerciseCacheRedis): Promise<T> {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  const key = 'exercise-pages:v3:' + hash;
  let revision: string | null = null;
  let cacheAvailable = false;
  try {
    const values = await store.mget(exercisePageRevisionKey, key) as [string | null, Entry<T> | null];
    revision = values[0];
    cacheAvailable = true;
    if (values[1] && values[1].revision === revision) return values[1].value;
  } catch { /* Database remains authoritative when the optional cache is down. */ }
  const requestKey = key + ':' + revision;
  const existing = pending.get(requestKey);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const value = await load();
    if (cacheAvailable) {
      // Tag the original revision: a catalog edit during the query cannot
      // republish an old result as fresh after invalidation.
      try { await store.set(key, {revision, value}, {ex:120}); } catch {}
    }
    return value;
  })();
  pending.set(requestKey, request);
  try { return await request; } finally {
    if (pending.get(requestKey) === request) pending.delete(requestKey);
  }
}

export async function invalidateExercisePageCache(store:ExercisePageCacheStore = exerciseCacheRedis) {
  await store.set(exercisePageRevisionKey, randomUUID());
}
