# Google sign-in and Google Play billing: readiness and setup plan

Reviewed: 2026-10-27. Scope: inspect the existing integration and prepare an Android setup and release plan. This review does not enable providers, change credentials, migrate a database, or publish a release. Console settings and deployed environments have not been inspected.

Implementation update: the user subsequently authorized setup and the Setcraft identity migration. The tables below describe the original review snapshot. See [current Setcraft setup status](setcraft-setup-status.md) for the renamed packages, Firebase/Play registration, completed checks, and outstanding Google sign-in and billing steps.

## Readiness assessment

The main authentication and store billing flows already exist. The immediate work is configuration, release signing, public legal pages, and real device/store validation. Passing local tests would not establish that live Google sign-in or checkout works.

| Area | Evidence in this checkout | Remaining work |
| --- | --- | --- |
| Google sign-in | `mobile/lib/features/auth/data/social_sign_in.dart` uses Google Sign-In, then Firebase Authentication. `backend/modules/auth/social_auth_service.ts` exchanges the Firebase ID token for Setcraft tokens. | Enable the Firebase provider, configure signing certificates/OAuth clients, apply the identity migration if pending, and enable the client/server switches. |
| Local Firebase client | `mobile/android/app/google-services.json` exists for `com.example.fitai_mobile`, but its client has no OAuth entries. | Re-download the client configuration after Google provider and certificate setup; verify the Android OAuth registrations and Web client ID. |
| Firebase Admin | `backend/secrets/firebase-admin.json` exists. `backend/config/firebase.ts` automatically uses this default path even without an environment variable. | Validate the project match, key validity, and Firebase Authentication access. File existence does not prove successful token verification. |
| Social-auth switch | `SOCIAL_AUTH_ENABLED` is unset in local `backend/.env` and the review shell. Client switches default to false. | Enable only after the staged flow works. A compiled APK's define values were not inspected. |
| Play purchases | Flutter native purchase/restore, backend Play verification and acknowledgement, account binding, RTDN authentication, and membership gating exist. | Configure the Play app, products, billing API identity, and authenticated Pub/Sub push. |
| Local Play configuration | No Play credential path/ADC, RTDN audience/email, or subscription legal URLs are configured in local `.env` or the review shell. The default `backend/secrets/google-play.json` file is absent. | Provision these in the actual backend environment and verify access. Deployed configuration may differ. |
| Android release | Package/namespace are `com.example.fitai_mobile`; `release` currently uses the debug signing configuration. | Confirm the permanent package name, configure an upload key and Play App Signing, and register the certificates used by installed builds. |
| Public destinations | `website/src/config/site.ts` has empty privacy/terms/store links. Mobile API configuration falls back to an ngrok URL. | Publish actual legal pages, set a stable HTTPS API URL, and configure the release build. Empty website links are not legal pages. |
| Database | `AuthIdentity` and migration `20261024120000_social_auth_identity` exist. Subscription fields already exist in the schema. | Check migration status in each target database. This review did not inspect the live database or establish that migrations are applied. |

The existing dependency declarations include `google_sign_in` 7.2.0, Firebase Auth, `in_app_purchase`, and its Android implementation. Reuse these integrations. Check the resolved native Billing Library version before release; the package name/version alone does not establish Play submission eligibility.

## Intended flows and existing behavior

Google account selection -> Google ID token -> Firebase sign-in -> **Firebase ID token** -> `POST /api/auth/social` -> Setcraft access/refresh tokens -> onboarding and membership checks.

The API expects the Firebase token, not the original Google ID token. It checks revocation and a recent authentication time. An existing Firebase UID returns its established Setcraft account. A new identity with an email already belonging to an email/password account receives HTTP 409; automatic email-based linking is deliberately absent. The release must preserve that behavior or separately design authenticated account linking.

Play product query -> native Play checkout -> purchase token -> authenticated `POST /api/subscription/android/verify` -> server reads current Play state -> saves the account-bound entitlement -> acknowledges an active purchase -> membership access updates.

The server requires the SHA-256 Setcraft account binding returned in subscription status. A successful Google login does not grant a trial or membership. New trials come from eligible native store offers; `/api/subscription/start-trial` cannot grant a new trial. Existing legacy trial expiry is preserved.

Prices shown at checkout come from Play. `backend/data/subscription_prices.json` contains draft target prices and product/base-plan identifiers; it does not set Play's prices.

## 1. Confirm the release identity and destinations

Before registering products or changing Firebase configuration, confirm:

- The permanent Android application ID. Retaining the current ID is possible only if it is available and intended; if the app already exists in Play, use that existing identity.
- The Firebase/Google Cloud project and Google Play developer account that will own the app.
- The stable HTTPS backend origin, public terms/privacy URLs, and support contact.
- Launch countries, monthly/annual prices, and whether to retain the existing eligible-new-customer 14-day trial.

If the application ID changes, update Android namespace/application ID and Kotlin package layout, Firebase app registration/configuration, and `GOOGLE_PLAY_PACKAGE_NAME` together. Review `androidPackageName` in `backend/data/subscription_prices.json` as the fallback. Keep the existing product IDs unless there is a deliberate catalog change.

Configure a release upload key and Play App Signing. Google signs Play-installed apps with the app signing key; its fingerprint can differ from the upload key. Register fingerprints for the builds actually used for sign-in: development/debug, locally signed test builds where relevant, and the Play app signing certificate. Use both SHA-1 and SHA-256 where supported by Firebase configuration. [Android app signing](https://developer.android.com/studio/publish/app-signing).

## 2. Configure Google sign-in

1. In the same Firebase project used by the mobile app, enable the Google authentication provider and complete the required public branding/support settings.
2. Register the final Android package and signing fingerprints. Verify the corresponding Android OAuth clients, then download a fresh `google-services.json` into `mobile/android/app/`. The current Gradle Google Services plugin is already wired.
3. Identify the project's **Web application OAuth client ID**. This is the value for `SETCRAFT_GOOGLE_SERVER_CLIENT_ID`; an Android OAuth client ID is not a substitute. This code requires the define even when native configuration can otherwise supply a default. See [Firebase federated auth](https://firebase.google.com/docs/auth/flutter/federated-auth) and the [Flutter Android integration](https://pub.dev/packages/google_sign_in_android).
4. Confirm the backend Admin credential belongs to the same Firebase project and can verify tokens including revocation. The existing default file can be used, or set `FIREBASE_SERVICE_ACCOUNT_FILE` explicitly. This code also supports ADC when `GOOGLE_APPLICATION_CREDENTIALS` is set; a host's implicit workload identity alone does not satisfy the current initializer's environment check.
5. In staging, inspect migration status and apply the reviewed pending migrations before enabling social auth. Prisma migration deployment applies all pending migrations, so inspect the full pending set. The identity migration is additive; it does not link existing users by email.
6. Deploy the server with `SOCIAL_AUTH_ENABLED=true`, then build the Android test app with the public client ID and stable API URL. Test both a fresh account and a returning account before enabling the feature for production users.

Example build template, run from `mobile/` after release signing is configured:

```powershell
flutter build appbundle --release `
  --dart-define=FITAI_API_BASE_URL=https://YOUR_API_ORIGIN `
  --dart-define=SETCRAFT_GOOGLE_SIGN_IN=true `
  --dart-define=SETCRAFT_GOOGLE_SERVER_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

These defines contain public configuration. Service-account keys remain on the backend. Copying an example env file does not make its placeholder paths or values valid.

## 3. Configure the Play subscription catalog

The current code expects this exact catalog:

| Interval | Subscription product ID | Base-plan ID | Recurring period |
| --- | --- | --- | --- |
| Monthly | `fitai_premium_monthly` | `monthly` | `P1M` |
| Annual | `fitai_premium_annual` | `annual` | `P1Y` |

Create and activate both auto-renewing base plans in the intended countries and set the actual regional prices in Play Console. For the existing trial behavior, add a new-customer acquisition offer with one free phase of `P2W` or `P14D`, followed directly by the recurring price. The current app rejects other introductory-phase shapes; returning/ineligible users should see the paid base plan with no trial promise. Configure new-customer eligibility in Play, rather than a repeatable developer-determined trial.

Complete the Play account's required payments/merchant, app, and monetization setup and upload the billing-enabled test release. [Play Billing setup](https://developer.android.com/google/play/billing/getting-ready).

## 4. Configure backend Play verification and RTDN

Enable the Google Play Android Developer API in the chosen Cloud project. Invite the backend service-account email through Play Console Users & permissions, give it access to this app, and grant the billing permissions **View financial data, orders, and cancellation survey responses** and **Manage orders and subscriptions**. A Firebase messaging key does not automatically confer Play billing access. [Google Play Developer API access](https://developers.google.com/android-publisher/getting_started).

Use the existing env examples as templates:

```dotenv
# Backend only; use actual paths and deployment values.
SOCIAL_AUTH_ENABLED=true
FIREBASE_PROJECT_ID=YOUR_FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-admin.json
GOOGLE_PLAY_PACKAGE_NAME=YOUR_FINAL_ANDROID_PACKAGE
GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=secrets/google-play.json
GOOGLE_PLAY_RTDN_AUDIENCE=https://YOUR_API_ORIGIN/api/subscription/google/notifications
GOOGLE_PLAY_RTDN_EMAIL=YOUR_PUSH_AUTH_SERVICE_ACCOUNT_EMAIL
SUBSCRIPTION_TERMS_URL=https://YOUR_PUBLIC_SITE/terms
SUBSCRIPTION_PRIVACY_URL=https://YOUR_PUBLIC_SITE/privacy
```

Relative credential paths resolve from the backend process's working directory; use provisioned absolute paths if the deployment starts elsewhere. The current `billingReady` flag checks configuration presence and valid HTTPS legal URL syntax, not credential validity, API permissions, catalog availability, or successful page responses. Verify those separately.

RTDN setup has three identities with different purposes:

1. Grant Google's Play notification publisher, `google-play-developer-notifications@system.gserviceaccount.com`, Pub/Sub Publisher on the RTDN topic. Enter that topic in the app's Play monetization settings.
2. Create a **wrapped, authenticated push subscription** to `https://YOUR_API_ORIGIN/api/subscription/google/notifications`. Preserve the normal `message.data` envelope expected by the controller.
3. Select your push-auth service account, use its email for `GOOGLE_PLAY_RTDN_EMAIL`, and set the OIDC audience to the exact `GOOGLE_PLAY_RTDN_AUDIENCE`. This is the push identity, not Google's topic-publisher email. Ensure the Pub/Sub service agent has the token-creation permissions described by Google. Preserve the Bearer authorization header through the proxy.

Send a Play Console test notification and verify HTTP 204. Then test a real subscription lifecycle event: the test notification alone does not prove purchase verification or entitlement updates. The handler re-reads Play state for known tokens; initial ownership for unknown tokens comes from the authenticated app verify/restore flow. [RTDN setup](https://developer.android.com/google/play/billing/getting-ready), [authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## 5. Validate before release

Check the **resolved** Android Billing Library version in the release dependency graph and merged manifest. As of this review, version 7's normal new-app/update deadline has passed; version 8's deadline is August 31, 2027, and version 9's is August 31, 2028. Verify the actual release meets current Play requirements before deciding whether any dependency change is necessary. [Billing Library submission deadlines](https://developer.android.com/google/play/billing/deprecation-faq).

Use an internal Play test track and install the signed release through its opt-in link. Add testers as **license testers** as well as track testers to use test payment instruments; a test track alone can still charge real money. Eligible license testers can also sideload for development, but that does not validate the Play-distributed release and its signing/OAuth setup. [Play Billing testing](https://developer.android.com/google/play/billing/test).

| Validation | Required result |
| --- | --- |
| Google login: debug and Play-installed release | Correct account; Firebase exchange returns a Setcraft session; onboarding resumes correctly. |
| Existing email/password account chooses Google | The current explicit existing-account message appears; no duplicate or implicit account link. |
| Canceled, expired, revoked, wrong-project, or malformed auth token | Cancellation is recoverable; invalid authentication cannot create a usable session. |
| Monthly and annual: eligible and ineligible users | Correct localized renewal amount/period; 14-day claim only for a valid eligible offer. |
| Native checkout, pending/declined/canceled payment, verification outage | Only server-confirmed access unlocks; recovery is usable. |
| Restore/reinstall and a different Setcraft account | Original owner can restore; another account cannot take the entitlement. |
| Renewal, cancellation before expiry, grace, hold, expiry, refund/revocation | Backend entitlement and the app gate follow current store state; notifications and periodic refresh recover missed delivery. |
| Legal and account controls | Real public legal pages open; restore, subscription management, sign-out, and privacy/account actions remain reachable. |

Relevant existing local checks, run from their respective folders:

```powershell
# backend/
npm run build
node --use-system-ca --import tsx scripts/test_social_auth.ts
npm run test:subscription

# mobile/
flutter test test/auth_entry_redesign_test.dart test/subscription_test.dart
```

The social-auth script uses injected claims and mocked persistence; it does not verify real Google/Firebase access. The backend subscription script uses the configured database to create and delete disposable users, so run it against a designated test database. Flutter fixtures do not prove a real purchase. No production database test or migration is part of this review.

Verification performed during this review: `node --use-system-ca --import tsx scripts/test_social_auth.ts` passed, covering the default-off switch, claims and fresh authentication, stable identity, rejection of implicit linking, no trial grants, bounded inputs, and rate limiting. Its persistence is mocked and it performed no database writes. The backend build, database-backed subscription suite, Flutter suite, live Firebase exchange, and real Play purchases were not run as part of this planning review.

## Additional payment providers and iOS

No Razorpay, Stripe, or PayPal integration was found in the inspected app/backend payment paths. Keep Play Billing as the initial Android purchase channel for the app's digital fitness subscription. External billing requires a separate market/distribution decision and implementation. Google permits alternatives under applicable regional programs and enrollment conditions; India's alternative-billing program also has transaction-reporting requirements. Adding a generic payment SDK alone does not complete those requirements. [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en), [India alternative billing](https://support.google.com/googleplay/android-developer/answer/13306652?hl=en).

iOS is a separate release milestone. Apple purchase verification already exists, but local Apple billing configuration is unset and `GoogleService-Info.plist` is absent. Google sign-in also needs iOS Firebase configuration, its iOS OAuth client ID, and the reversed-client-ID URL scheme; `Info.plist` currently has no Google callback scheme. Follow the [Flutter iOS Google integration](https://pub.dev/packages/google_sign_in_ios), review Apple's login requirements, and use the existing [store subscription runbook](../modules/subscription/README.md) for Apple keys, products, notifications, and sandbox validation on Apple hardware.

## Completion criteria

The Android integration is ready when the permanent identity/signing setup is established, real Google sign-in works in the Play-installed release, both products are available with correct prices/offers, backend verification and RTDN update ownership-bound access correctly, legal destinations are live, and the failure/restore/lifecycle cases above pass. The next concrete inputs are the final package ID, owning accounts/project, production URLs, and approved countries/prices/trial terms.
