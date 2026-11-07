# Support and settings rollout

Implemented: authenticated tickets, conversation replies, private optional screenshots,
staff assignment/status/internal notes, native JSON export, AI sharing consent with
withdrawal and an audit, current app version, and inline notification preferences.

## Deploy in this order

1. Back up the intended database. Review the local migration, then run
   `npx prisma migrate deploy` and `npx prisma generate` in backend.
   The local development database was updated during the settings repair.
   Apply the migrations separately to any other deployment database.
2. Fill the public environment values from `support-settings.env.example`.
   Empty emails/legal links stay unavailable. Policy/Terms links must use HTTPS.
   AI sharing cannot be enabled until a Privacy Policy URL is published.
   Name the actual recipient with AI_PROVIDER_NAME. Provider/endpoint changes
   require fresh consent.
3. Build with `npm run build`, which also copies the support website into dist.
   Deploy the backend. The public contact page is YOUR_API_ORIGIN/support;
   the protected staff inbox is YOUR_API_ORIGIN/support/admin.
4. Choose an existing Setcraft email/password account for staff access.
   Preview it with `node --import tsx scripts/configure_support_admin.ts
   --email=YOUR_ACCOUNT_EMAIL`. Rerun with `--apply` when ready.
   No account was promoted during development. Existing ADMIN roles also work.
5. Ship a new mobile binary for export sharing/version diagnostics. Native code
   needs a full rebuild. Validate iPhone/iPad sharing in Xcode; this Windows host
   cannot compile iOS.

## Operating behavior

- Admin API authorization uses the current database role, never a client claim.
  Browser access tokens stay in memory; sign in again when the short session expires.
- Optional screenshots are private PostgreSQL bytes, PNG/JPEG only, up to 1 MiB,
  4096 pixels per side and five per ticket. No public screenshot URLs.
  User ticket JSON and exports exclude internal staff notes.
- Diagnostics are opt-in: app/build/platform/OS version only. Recognizable pasted
  bearer/JWT/MCP credentials are redacted; this is not a complete sensitive-data filter.
- Retried submissions use client request IDs. Database locks bound creation/message
  limits across instances; stale admin edits are rejected.
- Open conversations refresh every 30 seconds while the app is foregrounded.
  Lists and the staff inbox offer manual refresh. Email alerts and support push
  notifications are not configured or sent. Someone must monitor the inbox.
- AI sharing is off by default. Consent is checked on plan/starter/food refresh
  requests and again before each provider attempt. Work already sent cannot be
  recalled. Imported health readings and photos are excluded, including derived
  wearable recovery input. Existing plans remain accessible after withdrawal.
- JSON exports contain structured records and attachment metadata, not image bytes.
  Use the existing private image-access workflow when responding to a full data request.
- Deleting an account cascades through tickets, attachments and consent records.
  Orphaned LangGraph checkpoints are cleaned periodically so late worker writes
  do not preserve deleted snapshots. Body image object deletion uses the existing
  durable queue. Describe backup/provider retention accurately in the policy.

## What the owner still needs to add

Support/privacy email(s), admin account email, actual Privacy Policy/Terms URLs,
policy publication date and confirmation of the AI provider. Publish the deployed
Support URL in store listings. Finalize real retention/subprocessor disclosures,
App Store privacy labels, Play Data Safety and SDK privacy declarations.

Apple sign-in token revocation and external subscription/provider retention remain
responsibilities of the existing auth/billing integrations; these screens do not
implement third-party account deletion. No GDPR certification or arbitrary retention
promise is made.

## Checks

`node --import tsx scripts/test_support_privacy.ts` runs real Express/auth/service
logic with in-memory persistence and rate-limit stubs. It never writes to a live
database, calls Redis, sends email or makes a paid provider request. After migration,
a staging smoke test is still needed for SQL constraints, storage and deployed URLs.
