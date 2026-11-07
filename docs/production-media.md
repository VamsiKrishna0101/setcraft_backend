# Production media rollout

Updated 2026-11-05.

The `r2.dev` public development endpoints have a variable rate limit. A paid
Cloudflare website plan does not remove that development-endpoint limitation.
Use R2 custom domains for production catalogue traffic.

## Account changes

`setcraft.fit` was added to the existing Cloudflare account on the Free plan.
Existing GoDaddy DNS records were imported. GoDaddy accepted and displays the
assigned nameservers `aron.ns.cloudflare.com` and `chuck.ns.cloudflare.com`.
DNSSEC was already off. Cloudflare now confirms the zone is active. All four
custom domains below were attached with minimum TLS 1.2. Real objects in each
bucket passed HTTPS range requests with HTTP 206. The four settings were
enabled in the local backend `.env`. The existing local source backend was
restarted to load them; a cloud API has not yet been deployed.

## Domain map

| Public R2 bucket | Intended hostname | Environment setting |
| --- | --- | --- |
| fitai-exercise-media | media.setcraft.fit | R2_EXERCISE_PUBLIC_URL |
| fitai-exercise-media-female | media-female.setcraft.fit | R2_EXERCISE_FEMALE_PUBLIC_URL |
| fitai-exercise-images | exercise-images.setcraft.fit | R2_EXERCISE_IMAGES_PUBLIC_URL |
| fitai-food-images | food-images.setcraft.fit | R2_FOOD_PUBLIC_URL |

Do not attach a public domain to `fitai-body-images`. Body and progress photos
use separate authenticated application routes and are excluded from URL rewriting.
Unrelated R2 buckets are outside this application migration.

## Complete the rollout

1. Domain activation and four HTTPS object checks are complete.
2. All listed custom domains are attached with minimum TLS 1.2.
3. Supply the four settings from `r2-production.env.example` to the production backend
   environment. In a fresh shell, verify real object delivery before restarting:

   ```powershell
   # From backend/, with the four settings and existing R2 credentials available:
   node --use-system-ca --import tsx scripts/check_production_media.ts
   ```

4. Build and deploy/restart the backend only after all four checks pass. Verify
   `/health` plus authenticated exercise and nutrition responses return the new
   hosts and that a video range request works in the mobile app.
5. Keep the existing development endpoints enabled while older app caches still
   contain their URLs. Disable them only after that compatibility window ends.

The response-boundary rewriter translates allowlisted public catalogue origins
even in old database rows and cached JSON. It preserves object paths, does not
mutate stored data, and leaves private-photo URLs, credentials, signed query
URLs, and unknown origins unchanged. Exercise validation accepts only the
legacy and configured origins for the correct presentation variant.

Rollback: remove the four new settings and restart the backend. No database
migration or Redis flush is required.

## API hosting still required

The checked mobile default points to ngrok and the backend setup notes describe
a local server. This change does not deploy a production API or make a local
PC a production host. The owner chose to continue with ngrok for now and deploy
to Google Cloud Run later. No Railway project, subscription or secret transfer
was performed. The generic Dockerfile is prepared but has not been built in
Linux. The existing ngrok origin is
`https://27dc-2401-4900-889d-5b4b-dd79-e94c-4489-b65b.ngrok-free.app`.
The mobile default already matches it; backend `PUBLIC_APP_URL` and
`MCP_PUBLIC_URL` now use the same tunnel. Before attaching
`api.setcraft.fit`, configuring its environment/secrets and database connectivity,
or updating the mobile production API origin. Never point production DNS at an
ephemeral ngrok hostname.

Reference: https://developers.cloudflare.com/r2/buckets/public-buckets/
