import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../config/prisma';

export const MCP_SCOPES = ['training:read', 'plans:read', 'workouts:read', 'nutrition:read', 'measurements:read'] as const;
export const tokenInput = z.object({
  name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]+$/),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(5).refine(v => new Set(v).size === v.length),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
}).strict();
export type McpScope = typeof MCP_SCOPES[number];
export type McpPrincipal = { userId: string; tokenId: string; scopes: string[] };
export class McpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

export function hashKey() {
  const value = process.env.MCP_TOKEN_HASH_KEY_BASE64 ?? '';
  const key = Buffer.from(value, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || key.length !== 32)
    throw new McpError(503, 'MCP_UNAVAILABLE', 'AI connections are not configured yet. Please try again later.');
  return key;
}
export function mcpConfiguration() {
  try {
    hashKey();
    const url = new URL(process.env.MCP_PUBLIC_URL ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') return null;
    return url.toString();
  } catch { return null; }
}
export function tokenDigest(token: string) {
  return createHmac('sha256', hashKey()).update('setcraft:mcp:v1:' + token).digest('hex');
}
export function mintToken() {
  const id = randomUUID();
  const secret = `sc_mcp_${id}.${randomBytes(32).toString('base64url')}`;
  return {id, secret, secretHash: tokenDigest(secret), lastFour: secret.slice(-4)};
}
const metadataSelect = { id: true, name: true, lastFour: true, scopes: true, createdAt: true,
  expiresAt: true, lastUsedAt: true, revokedAt: true } as const;

export async function listTokens(userId: string) {
  const now = new Date();
  const [active, recent] = await Promise.all([
    prisma.mcpAccessToken.findMany({where: {userId, revokedAt: null, expiresAt: {gt: now}}, select: metadataSelect, orderBy: {createdAt: 'desc'}, take: 5}),
    prisma.mcpAccessToken.findMany({where: {userId, OR: [{revokedAt: {not: null}}, {expiresAt: {lte: now}}]}, select: metadataSelect, orderBy: {createdAt: 'desc'}, take: 30}),
  ]);
  return { configured: !!mcpConfiguration(), serverUrl: mcpConfiguration(),
    tokens: [...new Map([...active, ...recent].map(token => [token.id, token])).values()], maxActiveTokens: 5 };
}
export async function createToken(userId: string, input: z.infer<typeof tokenInput>, replaceId?: string) {
  if (!mcpConfiguration()) throw new McpError(503, 'MCP_UNAVAILABLE', 'AI connections are not configured yet. Please try again later.');
  const minted = mintToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 86400000);
  const token = await prisma.$transaction(async tx => {
    // Serialize cap checks and replacements for this owner across all API instances.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const owner = await tx.user.findUnique({where: {id: userId}, select: {isVerified: true}});
    if (!owner?.isVerified) throw new McpError(403, 'VERIFY_ACCOUNT', 'Verify your Setcraft account before creating an access token.');
    if (replaceId) {
      const previous = await tx.mcpAccessToken.findFirst({where: {id: replaceId, userId, revokedAt: null}});
      if (!previous) throw new McpError(404, 'TOKEN_NOT_FOUND', 'This access token is no longer available.');
      await tx.mcpAccessToken.update({where: {id: previous.id}, data: {revokedAt: now}});
      await tx.mcpAuditEvent.create({data: {userId, tokenId: previous.id, action: 'replaced', outcome: 'success'}});
    }
    const count = await tx.mcpAccessToken.count({where: {userId, revokedAt: null, expiresAt: {gt: now}}});
    if (count >= 5) throw new McpError(409, 'TOKEN_LIMIT', 'You already have five active tokens. Revoke one before creating another.');
    const saved = await tx.mcpAccessToken.create({data: {id: minted.id, userId, name: input.name,
      secretHash: minted.secretHash, lastFour: minted.lastFour, scopes: input.scopes, expiresAt}, select: metadataSelect});
    await tx.mcpAuditEvent.create({data: {userId, tokenId: saved.id, action: 'created', outcome: 'success'}});
    return saved;
  });
  // This is the only response that includes the raw credential. Never log it.
  return {token, secret: minted.secret, serverUrl: mcpConfiguration()};
}
export async function revokeToken(userId: string, id: string) {
  await prisma.$transaction(async tx => {
    const result = await tx.mcpAccessToken.updateMany({where: {id, userId, revokedAt: null}, data: {revokedAt: new Date()}});
    if (result.count) await tx.mcpAuditEvent.create({data: {userId, tokenId: id, action: 'revoked', outcome: 'success'}});
  });
}
export async function verifyMcpToken(header: string | undefined): Promise<McpPrincipal> {
  const match = /^Bearer (sc_mcp_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43})$/.exec(header ?? '');
  const invalid = () => new McpError(401, 'INVALID_TOKEN', 'This access token is invalid, expired or revoked. Create a new token in Setcraft.');
  if (!match || !z.string().uuid().safeParse(match[2]).success) throw invalid();
  const digest = tokenDigest(match[1]);
  const row = await prisma.$transaction(tx => tx.mcpAccessToken.findUnique({where: {id: match[2]}, select: {
    id: true, userId: true, secretHash: true, hashVersion: true, scopes: true, expiresAt: true, revokedAt: true,
    user: {select: {isVerified: true}},
  }}), {maxWait: 2000, timeout: 5000});
  const stored = Buffer.from(row?.secretHash ?? '0'.repeat(64), 'hex');
  const equal = stored.length === 32 && timingSafeEqual(stored, Buffer.from(digest, 'hex'));
  if (!row || !equal || row.hashVersion !== 1 || row.revokedAt || row.expiresAt <= new Date() || !row.user.isVerified) throw invalid();
  return {userId: row.userId, tokenId: row.id, scopes: row.scopes};
}
export async function auditCall(principal: McpPrincipal, action: string, outcome: string, durationMs: number) {
  await prisma.$transaction(async tx => {
    await tx.mcpAuditEvent.create({data: {...principalIdentity(principal), action, outcome, durationMs: Math.max(0, Math.round(durationMs))}});
    await tx.mcpAccessToken.updateMany({where: {id: principal.tokenId, userId: principal.userId,
      OR: [{lastUsedAt: null}, {lastUsedAt: {lt: new Date(Date.now() - 60000)}}]}, data: {lastUsedAt: new Date()}});
  }, {maxWait: 2000, timeout: 3000});
}
function principalIdentity(p: McpPrincipal) { return {userId: p.userId, tokenId: p.tokenId}; }
export async function pruneMcpHistory() {
  await prisma.mcpAuditEvent.deleteMany({where: {createdAt: {lt: new Date(Date.now() - 30 * 86400000)}}});
  const cutoff = new Date(Date.now() - 90 * 86400000);
  await prisma.mcpAccessToken.deleteMany({where: {OR: [{expiresAt: {lt: cutoff}}, {revokedAt: {lt: cutoff}}]}});
}
