import { Redis } from "@upstash/redis";
import "dotenv/config";

const connection = {
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
};

export const redis = new Redis(connection);

// A limiter outage must not leave normal app requests waiting through retries.
// This uses the same database and credentials, with a fresh deadline per request.
export const rateLimitRedis = new Redis({
  ...connection,
  retry: false,
  signal: () => AbortSignal.timeout(2000),
});

// Public catalog caching must fail open quickly when Redis is unavailable.
export const exerciseCacheRedis = new Redis({
  ...connection,
  retry: false,
  signal: () => AbortSignal.timeout(500),
});

export default redis;
