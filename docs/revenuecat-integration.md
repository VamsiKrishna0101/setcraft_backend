# RevenueCat integration

Updated November 4, 2026. Project `f749615c`, entitlement `setcraft_pro`, default offering with Test Store products `monthly` and `yearly`.

## Implemented

Flutter uses RevenueCat purchases and UI SDKs for its normal runtime, including the RevenueCat paywall, restore and Customer Center. Existing injected native-store adapters remain available for regression coverage and older clients. Login binds RevenueCat to the authenticated Setcraft UUID. Only trusted backend status unlocks the membership gate.

The backend fetches current RevenueCat REST v1 customer data using the configured project key. `/api/subscription/revenuecat/sync` requires the user's JWT and takes the customer ID from that JWT. It accepts no client entitlement claims. `/api/subscription/revenuecat/webhook` verifies the configured authorization header and re-fetches trusted customer state. User-level database locks serialize repeated/delayed events, with a stable subscription key for idempotent writes. Status checks reconcile after 30 seconds when a webhook is missed. Sandbox subscriptions have separate provider records and are excluded from production access, including cached records. Existing native memberships and legacy trials remain supported.

Local ignored `backend/.env` selects RevenueCat sandbox. It contains the Test Store API key, entitlement ID and a generated webhook authorization value. No new secret RevenueCat API key was needed for the read-only REST v1 integration. Never embed server secret keys in Flutter.

An authorized sandbox-only webhook named **Setcraft development sandbox** was saved in RevenueCat and a RevenueCat dashboard test delivery returned **HTTP 200**. It targets the currently running ngrok origin plus `/api/subscription/revenuecat/webhook`. Update the URL whenever that tunnel changes. This is a development endpoint, not a production deployment.

## Verification

- Backend TypeScript build passed.
- `npm run test:revenuecat` verifies entitlement expiry, trial, cancellation, refund, grace, environment boundaries and webhook authorization.
- `node --use-system-ca --import tsx scripts/test_revenuecat_integration.ts` passed using a disposable database account, including cached sandbox exclusion in production.
- `node --use-system-ca --import tsx scripts/check_revenuecat_live.ts` passed against the running development server and real RevenueCat API: empty customer stays locked, authenticated status/sync work, unauthenticated sync/webhooks are rejected, authorized webhook succeeds.
- Existing native backend subscription checks passed with `SUBSCRIPTION_PROVIDER=native`.
- All 25 Flutter subscription tests passed, including automatic RevenueCat entry, cancellation staying locked, and onboarding validation. Existing glass shader compatibility warnings were emitted.
- Android debug APK built at `mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- No Android device was connected for an interactive Test Store purchase. No signed iOS build or real store checkout was verified.

## Build configuration

Debug builds default to the project's Test Store. `REVENUECAT_USE_TEST_STORE=false` plus `REVENUECAT_ANDROID_KEY` / `REVENUECAT_IOS_KEY` allows native store sandbox testing later. Release/profile builds require the corresponding real platform key; a Test Store key is rejected outside debug mode.

Android Studio: open the `mobile` Flutter project, select **Setcraft Test Store**, select an Android emulator/device, and Run in Debug. Shared run configurations exist in both root and mobile `.run` directories. They explicitly enable Test Store and use the current ngrok API. Keep the backend and tunnel running; replace the API origin in both configurations and RevenueCat webhook/legal actions if the tunnel changes. No additional APK build is required.

Sign in, enter membership, and the published RevenueCat paywall opens automatically after onboarding validation. Choose a package and the Test Store success/failure/cancel option. Successful simulated payment must unlock only after backend synchronization. Cancel/failure must remain locked. Then check restore, restart/sign-in, and account switching. Test Store simulates transactions without charging; this does not verify Google Play or Apple checkout. A device transaction has not yet been performed in this session.

Settings → Setcraft Premium refreshes membership and opens the RevenueCat paywall directly for non-members or Customer Center for active members. It no longer pushes the old Flutter membership screen. Dismissing either returns to Settings; billing errors appear there, with repeated taps guarded during loading.

If a development install reports MissingPluginException for `setupPurchases` on `purchases_flutter`, stop the existing Flutter process and run the app again to rebuild/install its native plugins. Hot reload and hot restart do not add native dependencies. This was confirmed on the connected debug device; that same install also lacked local-notifications `initialize`, which blocked sign-out. Sign-out now treats notification/cache cleanup as optional while requiring secure credential removal to succeed, and native notification errors no longer skip remote push deregistration. Missing billing-plugin errors now explain the required full rerun.

Backend configuration:

```dotenv
SUBSCRIPTION_PROVIDER=revenuecat
REVENUECAT_PROJECT_ID=f749615c
REVENUECAT_ENTITLEMENT_ID=setcraft_pro
REVENUECAT_ENVIRONMENT=sandbox
REVENUECAT_API_KEY=<project REST v1-compatible key>
REVENUECAT_WEBHOOK_AUTH=<same authorization value saved in RevenueCat>
REVENUECAT_TEST_PUBLIC_ORIGIN=<current development HTTPS tunnel origin>
```

Production requires `REVENUECAT_ENVIRONMENT=production`, the correct production key, actual legal URLs and a stable HTTPS webhook origin. Production never accepts Test Store keys or sandbox entitlements.

## Paywall and remaining release work

RevenueCat paywall `wfb3ce6e62047c44ab` is published on the default offering; publication was verified in the dashboard. This project currently contains only the Test Store. The design uses dark Setcraft styling, Inter, silver controls, no decorative image, and three short benefits for workouts, nutrition and progress. Prices and trial disclosures use store variables.

Terms and Privacy actions point to reachable development information pages under `/api/subscription/testing/terms` and `/privacy` on the current tunnel. These pages explicitly identify simulated purchases and development data handling. They are enabled only in RevenueCat development sandbox and return 404 in production. They are not production legal policies; replace both paywall destinations and configure real backend legal URLs before store release. Public page availability and production guards are tested.

RevenueCat's default restore policy transfers purchases between accounts. Before real store testing/release, review and configure restore ownership to match Setcraft's account-bound purchase policy, and test account switching and deletion/re-registration.

Remaining for store release: finish Apple/Google merchant and developer setup; create/activate real products and eligible trials; upload billing credentials to RevenueCat; connect store notifications; complete legal policies, privacy/store disclosures and review metadata; validate real purchases/restores/renewals on Android and iOS hardware. RevenueCat does not replace the store accounts or guarantee review approval.

Design research: [RevenueCat paywall guide](https://www.revenuecat.com/blog/growth/guide-to-mobile-paywalls-subscription-apps), [Fitbod designer case study](https://www.sashadimov.com/fitbod).

A new black titanium/silver dumbbell visual was generated using the built-in imagegen skill and saved as `mobile/assets/branding/setcraft-premium-strength-v1.png`. It was removed from the paywall after user feedback to prioritize product value. Prompt direction: luxury sports editorial CGI of a single black titanium and brushed-silver dumbbell, dramatic monochrome rim lighting, black background, no text, logos, people or UI. It is a discarded visual option, not the current paywall hero.
