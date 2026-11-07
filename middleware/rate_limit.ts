import { createHmac } from "node:crypto";
import { Request, RequestHandler } from "express";
import ipaddr from "ipaddr.js";
import { rateLimitRedis } from "../config/redis";
import { appLocale } from "../utils/app_locale";
import { fitnessTerm } from "../utils/fitness_locale";

type Scope = "ip" | "email" | "user" | "refreshToken";

type Rule = {
  scope: Scope;
  limit: number;
  seconds: number;
};

type Policy = {
  strict: boolean;
  rules: Rule[];
};

// These are request allowances, not subscription entitlements. Keep all tuning
// here so API servers and workers use the same policy names and Redis keys.
export const rateLimits = {
  supportCreate: {strict: true, rules: [{scope:"user",limit:5,seconds:3600}, {scope:"user",limit:20,seconds:86400}]},
  supportReply: {strict: true, rules: [{scope:"user",limit:60,seconds:3600}]},
  edge: {
    strict: false,
    rules: [{ scope: "ip", limit: 1200, seconds: 60 }],
  },
  general: {
    strict: false,
    rules: [{ scope: "user", limit: 180, seconds: 60 }],
  },
  login: {
    strict: true,
    rules: [
      { scope: "ip", limit: 30, seconds: 900 },
      { scope: "email", limit: 5, seconds: 900 },
    ],
  },
  socialAuth: {
    strict: true,
    rules: [{ scope: "ip", limit: 20, seconds: 900 }],
  },
  sendOtp: {
    strict: true,
    rules: [
      { scope: "ip", limit: 20, seconds: 3600 },
      { scope: "email", limit: 1, seconds: 60 },
      { scope: "email", limit: 5, seconds: 3600 },
    ],
  },
  verifyOtp: {
    strict: true,
    rules: [
      { scope: "ip", limit: 40, seconds: 900 },
      { scope: "email", limit: 5, seconds: 900 },
    ],
  },
  register: {
    strict: true,
    rules: [
      { scope: "ip", limit: 10, seconds: 3600 },
      { scope: "email", limit: 5, seconds: 3600 },
    ],
  },
  refresh: {
    strict: true,
    rules: [
      { scope: "ip", limit: 300, seconds: 900 },
      { scope: "refreshToken", limit: 20, seconds: 60 },
    ],
  },
  photoScan: {
    strict: true,
    rules: [
      { scope: "user", limit: 3, seconds: 600 },
      { scope: "user", limit: 10, seconds: 86400 },
    ],
  },
  generatePlan: {
    strict: true,
    rules: [{ scope: "user", limit: 3, seconds: 3600 }],
  },
  schedulePreview: {
    strict: true,
    rules: [{scope: 'user', limit: 60, seconds: 60}],
  },
  scheduleChange: {
    strict: true,
    rules: [{scope: 'user', limit: 30, seconds: 3600}],
  },
  notificationTest: {
    strict: true,
    rules: [{ scope: "user", limit: 3, seconds: 600 }],
  },
  mcpCreate: {
    strict: true,
    rules: [{ scope: "user", limit: 5, seconds: 3600 }],
  },
} satisfies Record<string, Policy>;

export type RateLimitPolicy = keyof typeof rateLimits;

export type LimitBucket = {
  key: string;
  limit: number;
  seconds: number;
};

// Check every bucket before consuming any of them. Lua makes both steps atomic
// across server instances. Rejected requests never extend the original expiry.
const consumeScript = `
local retry = 0

for index, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[index * 2 - 1])
  local window = tonumber(ARGV[index * 2])
  local count = tonumber(redis.call('GET', key) or '0')
  local ttl = redis.call('PTTL', key)

  if count > 0 and ttl < 0 then
    redis.call('PEXPIRE', key, window)
    ttl = window
  end

  if count >= limit then
    retry = math.max(retry, math.max(1, ttl))
  end
end

if retry > 0 then
  return {0, math.ceil(retry / 1000)}
end

for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then
    redis.call('PEXPIRE', key, tonumber(ARGV[index * 2]))
  end
end

return {1, 0}
`;

export async function consumeRateLimit(buckets: LimitBucket[]) {
  if (!buckets.length) throw new Error("Missing rate limit identity");

  const keys = buckets.map((bucket) => bucket.key);
  const values = buckets.flatMap((bucket) => [
    bucket.limit,
    bucket.seconds * 1000,
  ]);
  const result = await rateLimitRedis.eval<number[], number[]>(
    consumeScript,
    keys,
    values,
  );

  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    ![0, 1].includes(result[0]!) ||
    !Number.isFinite(result[1])
  ) {
    throw new Error("Invalid rate limit response");
  }

  return {
    allowed: result[0] === 1,
    retryAfterSeconds: Math.max(1, result[1]!),
  };
}

// Internal test seam, like the photo-storage adapter. HTTP clients cannot select
// the store or disable enforcement.
export const rateLimitStore = { consume: consumeRateLimit };

export function rateLimitIp(address: string) {
  const parsed = ipaddr.process(address);
  if (parsed instanceof ipaddr.IPv6) {
    // A client can rotate IPv6 addresses within its network. Share its /64 limit.
    return (
      parsed.parts
        .slice(0, 4)
        .map((part) => part.toString(16))
        .join(":") + "::/64"
    );
  }
  return parsed.toString();
}

function identity(req: Request, scope: Scope): string | null {
  if (scope === "user") return req.user?.userId ?? null;
  if (scope === "ip")
    return rateLimitIp(req.ip ?? req.socket.remoteAddress ?? "127.0.0.1");

  const value = scope === "email" ? req.body?.email : req.body?.refreshToken;
  if (
    typeof value !== "string" ||
    value.length > (scope === "email" ? 254 : 8192)
  )
    return null;
  return scope === "email" ? value.trim().toLowerCase() : value;
}

export function rateLimitBuckets(
  name: RateLimitPolicy,
  req: Request,
): LimitBucket[] {
  const secret =
    process.env.RATE_LIMIT_KEY_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("Rate limit key secret is unavailable");

  return rateLimits[name].rules.flatMap((rule) => {
    const value = identity(req, rule.scope);
    if (!value) return [];

    // Redis keys contain no raw email addresses, IPs or bearer/refresh tokens.
    const hash = createHmac("sha256", secret)
      .update("fitai-rate-limit:" + rule.scope + ":" + value)
      .digest("hex");

    return [
      {
        key: `fitai:{rate-limit}:v1:${name}:${rule.scope}:${rule.seconds}:${hash}`,
        limit: rule.limit,
        seconds: rule.seconds,
      },
    ];
  });
}

// Explicit addresses/subnets only. Never trust arbitrary forwarded headers or
// enable trust proxy for every peer. Leave unset for direct local development.
export function trustedProxies(value = process.env.TRUSTED_PROXY_CIDRS ?? "") {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => {
      if (!address.includes(".") && !address.includes(":")) {
        throw new Error(
          "TRUSTED_PROXY_CIDRS requires explicit IP addresses or subnets",
        );
      }
      if (address.includes("/")) {
        const [, prefix] = ipaddr.parseCIDR(address);
        if (prefix === 0) throw new Error("Do not trust every proxy address");
      } else {
        ipaddr.parse(address);
      }
      return address;
    });
}

let lastWarning = 0;

export function rateLimit(name: RateLimitPolicy): RequestHandler {
  return async (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (
      rateLimits[name].rules.some((rule) => rule.scope === "user") &&
      !req.user
    ) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let retry = 0;
    let unavailable = false;

    try {
      const result = await rateLimitStore.consume(rateLimitBuckets(name, req));
      if (result.allowed) return next();
      retry = result.retryAfterSeconds;
    } catch {
      if (Date.now() - lastWarning > 60000) {
        lastWarning = Date.now();
        console.warn("Rate limit store unavailable", { policy: name });
      }
      if (!rateLimits[name].strict) return next();
      unavailable = true;
      retry = 30;
    }

    const template = unavailable
      ? "Service is temporarily busy. Please try again in {seconds} seconds."
      : "Please try again in {seconds} seconds.";
    const message = fitnessTerm(
      template,
      appLocale(req.headers["accept-language"]),
    ).replace("{seconds}", String(retry));

    res.set("Retry-After", String(retry)).set("Cache-Control", "no-store");
    res.status(unavailable ? 503 : 429).json({
      error: message,
      code: unavailable ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
      retryAfterSeconds: retry,
    });
  };
}
