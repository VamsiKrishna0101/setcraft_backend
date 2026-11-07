import redis from "../../config/redis";

const requests = new Map<string, Promise<unknown>>();

export async function progressRevision(owner: string) {
  try {
    return (await redis.get<string>(`progress-revision:${owner}`)) ?? "initial";
  } catch {
    return `uncached-${Date.now()}-${Math.random()}`;
  }
}

export async function progressCached<T>(
  owner: string,
  suffix: string,
  load: () => Promise<T>,
): Promise<T> {
  const revision = await progressRevision(owner);
  const key = `history:progress:${owner}:v8:${revision}:${suffix}`;
  try {
    const cached = await redis.get<T>(key);
    if (cached) return cached;
  } catch {}
  if (requests.has(key)) return requests.get(key) as Promise<T>;
  const request = (async () => {
    const value = await load();
    try {
      await redis.set(key, value, { ex: 300 });
    } catch {}
    return value;
  })();
  requests.set(key, request);
  try {
    return await request;
  } finally {
    requests.delete(key);
  }
}

export async function invalidateProgress(owner: string) {
  try {
    await redis.set(
      `progress-revision:${owner}`,
      `${Date.now()}-${Math.random()}`,
      { ex: 86400 },
    );
  } catch {}
}
