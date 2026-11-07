# Setcraft personal-token MCP connection

This release supports Claude/custom MCP clients with a fixed Authorization header.
It does not implement OAuth or claim ChatGPT's consumer connection is available.
No LLM API key or mobile session token is shared with the external client.

## Deployment

1. Apply Prisma migrations, then generate the Prisma client.
2. Set `MCP_TOKEN_HASH_KEY_BASE64` to 32 cryptographically random bytes in base64,
   held in the deployment's secret store. Never commit or print it. Preserve this
   key across restarts; changing it invalidates the v1 credentials.
3. Set `MCP_PUBLIC_URL` to the stable public HTTPS URL ending exactly in `/mcp`.
   The local preview is configured to its existing development tunnel; production
   must use a stable deployment URL. TLS terminates at the trusted reverse proxy.
4. Configure trusted proxy CIDRs explicitly so edge limits use trustworthy IPs.
5. Build/restart the backend. The connection remains disabled if configuration is
   missing. Token revocation remains available even when MCP is unavailable.

`scripts/configure_mcp_local.ts <https-url>/mcp` writes a new local key only when
one is absent, without printing it. Production configuration uses secret storage.

The PostgreSQL provider's encryption at rest/backups must be enabled independently;
this change stores an irreversible HMAC verification value, not a decryptable token.

## Credential lifecycle

Normal authenticated app routes live at `/api/integrations/mcp/tokens`:

- GET: metadata and configured public URL, never the hash or secret. Includes all
  active tokens plus the latest 30 inactive tokens.
- POST: strict name/scopes/expiry input, issue a secret exactly once.
- POST `/:id/replace`: owner-checked replacement and revocation in one transaction.
- DELETE `/:id`: idempotent owner-scoped revocation; no MCP quota dependency.

Creation requires a verified Setcraft user. Locking that user's row serializes the
five-active-token cap across instances. Expiries are 7, 30 (default), or 90 days.
The raw token is random, contains no user ID/email, and is kept only in the create
response and temporary one-time app screen. Losing a response requires replacement.
There is no reveal-later endpoint. New requests validate the live token record;
credentials cannot authenticate ordinary app routes or create other credentials.

Android copy marks the clipboard sensitive and protects the one-time screen from
screenshots. iOS uses a local-only clipboard entry with a five-minute expiry.
The value is never copied automatically or stored in app preferences. Backgrounding
masks a revealed token. Account ownership is checked before copying or revealing.

## Tools and permissions

`get_connected_account` and `get_exercise_details` are available to authenticated
tokens. Other tools require their individual scopes:

| Scope | Tools |
|---|---|
| training:read | get_training_profile |
| plans:read | get_weekly_workouts |
| workouts:read | get_workout_history, get_training_progress |
| nutrition:read | get_nutrition_summary |
| measurements:read | get_measurement_trends |

Nutrition and measurements are off initially in the app. All tools are read-only;
scope-filtered discovery and execution checks are both enforced. Identity always
comes from authenticated credentials, never a tool argument. Planned prescriptions
and actual recorded sets have separate tools. No photos, medical/allergy notes,
wearable records, billing data or mutations are exposed. Measurements are entered
records only and include units/source; photo-derived metrics are excluded.

Queries use bounded pagination (at most 10 records per page), date ranges up to
90 days, capped nested records, a read-only database transaction with statement
timeout, and a 100 KB serialized result limit. MCP payloads are limited to 32 KB
and 100 schema elements. JSON-RPC batches are rejected. HTTP request timeout is
30 seconds. An aborted request keeps its execution slot until its bounded work
finishes, preventing rapid disconnects from bypassing concurrency limits.

## Abuse controls and logging

- Creation/replacement: 5/hour/user through the existing Redis limiter.
- Tool execution: 30/minute/token, 60/minute/user, 1,000/day/user.
- Protocol traffic: 120/minute/token, 180/minute/user, plus coarse IP filtering.
- Execution concurrency: 3/account, backed by expiring Redis leases shared across
  instances. Slot release is idempotent and independent of transport cleanup.
- Unavailable limiter: 503, never unlimited access. Exceeded limits: 429 with
  Retry-After. Normal app revocation does not consume the MCP allowance.

Secrets do not enter request logs, audit records, user exports or Redis keys.
MCP paths are consumed before the general logger, including unknown subpaths;
management URLs are excluded from the URL logger. Audit stores tool/action,
outcome, timing, user and token IDs, never tool arguments/results or secrets.
Events are retained 30 days; inactive token metadata is pruned after 90 days.
Account deletion cascades both tables. Privacy export includes safe token metadata
and retained audit events, excluding secret hashes. Redis counters expire naturally.

## Verification

Run `npm run test:mcp`, `npm run build`, and Flutter MCP/profile tests. The MCP
suite creates isolated fixture accounts and deletes only those accounts afterwards.
It exercises Express/MCP HTTP handling and an official SDK client via in-process
HTTP injection, with real PostgreSQL and Redis. This avoids a host-specific broken
plain-HTTP/SSE proxy, without disabling TLS verification or changing production
transport. Connecting a real Claude account remains a user setup action.

The MCP SDK is pinned through the lockfile to patched 1.32.0 or later. The dependency
audit also reports pre-existing Prisma toolchain advisories; they are separate from
the added MCP SDK and were not changed by this feature.
