import { createHmac, randomUUID } from 'node:crypto';
import { rateLimitRedis } from '../../config/redis';
import { consumeRateLimit, LimitBucket } from '../../middleware/rate_limit';
import { hashKey, McpError, McpPrincipal } from './mcp_tokens';

// Separate namespace from app browsing. All instances share Redis counters.
function identity(value: string) {
  // Same validation as token hashing: a malformed key never yields weak buckets.
  return createHmac('sha256', hashKey()).update('mcp-limit:' + value).digest('hex');
}
export function mcpBuckets(p: McpPrincipal, toolCall: boolean): LimitBucket[] {
  const user = identity(p.userId), token = identity(p.tokenId);
  const rules: Array<[string, number, number]> = [
    [`http:user:${user}`, 180, 60], [`http:token:${token}`, 120, 60],
  ];
  if (toolCall) rules.push([`tool:token:${token}`, 30, 60], [`tool:user:${user}`, 60, 60], [`daily:user:${user}`, 1000, 86400]);
  return rules.map(([suffix, limit, seconds]) => ({key: `setcraft:{mcp}:v1:${suffix}`, limit, seconds}));
}
export const mcpLimitStore = {consume: consumeRateLimit};
export async function checkMcpLimit(p: McpPrincipal, toolCall: boolean) {
  try {
    const result = await mcpLimitStore.consume(mcpBuckets(p, toolCall));
    if (!result.allowed) throw new McpError(429, 'RATE_LIMITED', 'Too many AI requests. Please try again shortly.', result.retryAfterSeconds);
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(503, 'MCP_BUSY', 'AI connections are temporarily busy. Please try again shortly.', 30);
  }
}
const acquireScript = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 3 then return 0 end
redis.call('ZADD', KEYS[1], now + 35000, ARGV[2])
redis.call('PEXPIRE', KEYS[1], 36000)
return 1`;
export async function acquireMcpSlot(p: McpPrincipal) {
  const key = `setcraft:{mcp}:v1:running:${identity(p.userId)}`, lease = randomUUID();
  try {
    const allowed = await rateLimitRedis.eval(acquireScript, [key], [Date.now(), lease]);
    if (Number(allowed) !== 1) throw new McpError(429, 'MCP_CONCURRENCY', 'Three AI requests are already running. Please retry shortly.', 5);
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(503, 'MCP_BUSY', 'AI connections are temporarily busy. Please retry shortly.', 30);
  }
  let released = false;
  return async () => {
    if (released) return; released = true;
    try { await rateLimitRedis.zrem(key, lease); } catch { /* Lease expires automatically. */ }
  };
}
