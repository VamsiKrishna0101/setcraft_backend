# API rate limits

`rate_limit.ts` owns the shared policies, Redis counters, proxy validation and
error responses. Routes only attach a named policy. No database migration or
separate Redis database is needed.

## Defaults

These count incoming attempts, including invalid requests and successful logins.
They use fixed windows starting with the first accepted request. Every applicable
bucket must have room. Rejected requests do not consume another bucket or renew
the waiting period.

| Policy                       | Allowance                                                  |
| ---------------------------- | ---------------------------------------------------------- |
| API before body parsing      | 1,200 requests per IP per minute                           |
| Authenticated API            | 180 requests per user per minute                           |
| Login                        | 30 per IP and 5 per email per 15 minutes                   |
| Send OTP                     | 20 per IP per hour; 1 per email per minute and 5 per hour  |
| Verify OTP                   | 40 per IP and 5 per email per 15 minutes                   |
| Register                     | 10 per IP and 5 per email per hour                         |
| Refresh session              | 300 per IP per 15 minutes; 20 per refresh token per minute |
| Scan / refresh body coaching | 3 per user per 10 minutes and 10 per 24 hours              |
| Generate / retry weekly plan | 3 per user per hour                                        |
| Send test notification       | 3 per user per 10 minutes                                  |

Normal measurement entries do not consume the AI scan allowance unless they ask
for coaching. Plan generation still enforces the existing weekly entitlement and
cooldown. These limits do not grant extra generations or subscription access.

Redis Lua checks and increments all buckets atomically across backend instances.
Keys expire automatically and contain HMACs instead of raw emails, IPs or refresh
tokens. IPv4-mapped addresses normalize to IPv4; IPv6 addresses share a /64 budget.

## Configuration

Use the existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on every
instance. An optional `RATE_LIMIT_KEY_SECRET` can be set to a long random secret;
otherwise the existing `JWT_ACCESS_SECRET` is used. All instances must use the
same secret. Changing it starts fresh counters.

`TRUSTED_PROXY_CIDRS` accepts comma-separated IP addresses or CIDRs belonging to
your actual reverse proxies. Leave it unset when connecting directly to the
backend. For a single proxy on the same machine, for example:

```dotenv
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

This is an example, not a deployment default. Configure the addresses for your
hosting environment, prevent direct public access around the proxy, and ensure
the proxy replaces client-supplied forwarding headers. Do not use `true`, numeric
hop counts, `0.0.0.0/0` or `::/0`. Without trusted proxy configuration, requests
behind a proxy share its IP allowance. User allowances remain separate.

## Failure behavior

Exhausted budgets return HTTP 429, `Retry-After`, `Cache-Control: no-store`,
`code: RATE_LIMITED` and `retryAfterSeconds`. Messages use the request language.
The mobile client shows the wait without replaying saves or clearing credentials.

Limiter Redis requests have a two-second deadline and no transport retries. If
Redis cannot be checked, login, OTP, registration, refresh, AI actions and test
notifications return HTTP 503 with `code: RATE_LIMIT_UNAVAILABLE` and a 30-second
retry hint. Broad API and user guards allow requests through during that outage;
there is no inconsistent per-process counter fallback. Endpoint dependencies can
still fail separately if their own Redis or database work is unavailable.

The IP guard runs before JSON parsing. Body photo routes retain a 12 MB parser
limit, other JSON uses 512 KB, and URL-encoded requests use 64 KB. Oversized bodies
return HTTP 413. Profile reads require a valid session and the same user ID.

## Verification and remaining work

Run `npm run test:rate-limit` and `npm run build`. The security test uses random,
temporary Redis keys and isolated profile fixtures; it does not send email, call
OpenAI or edit member records. Mobile regression tests are
`flutter test test/rate_limit_test.dart test/session_refresh_test.dart`.

This is an API abuse-control layer. It does not replace upstream DDoS protection,
atomic OTP verification, refresh-token rotation/revocation, distributed body-job
coordination or a deployment/security audit. Those remain separate work.
