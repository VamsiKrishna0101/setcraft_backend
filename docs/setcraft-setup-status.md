# Setcraft setup status

Updated 2026-10-27. Google sign-in is the current priority; Play billing is deferred until the merchant setup is complete.

## Identity now configured

| Item | Value |
| --- | --- |
| Public app name | Setcraft |
| Android application ID and namespace | `com.setcraft.app` |
| iOS bundle ID | `com.setcraft.app` |
| Flutter/Dart package | `setcraft` |
| Firebase display name | Setcraft |
| Existing Firebase project ID | `fitai-f52c0` (retained with its existing backend credential) |
| Firebase Android app | `1:796945284176:android:1ca5b3a9998b8a78c72555` |
| Play app | Setcraft, `com.setcraft.app`, draft app `4972978872445152348` |
| Planned subscription products | `setcraft_premium_monthly`, `setcraft_premium_annual` |

The Android Kotlin sources and Dart imports use the new package. App labels, artwork, and root application branding use Setcraft. Existing persisted storage keys, platform channel names, and the backend purchase-account hash retain their previous internal identifiers to preserve compatibility. The new Android package is a separate OS installation from the former debug package; server-side accounts are preserved.

An upload signing key was generated at `mobile/android/app/setcraft-upload.jks`, with its configuration in `mobile/android/key.properties`. Both are excluded by existing ignore rules. Keep a secure backup for future releases. Release builds now use this signing configuration instead of the debug key. Firebase contains SHA-1 and SHA-256 fingerprints for both the local debug and upload certificates. After Play App Signing is initialized, its separate app-signing fingerprints must also be registered for Play-installed Google sign-in.

The additive `20261024120000_social_auth_identity` schema was applied to the local database. The unrelated pending exercise-library migration was not executed. Existing account rows were not changed. Its Prisma migration-history entry is still pending because the permission prompt for the following bookkeeping command was declined before execution:

```powershell
# From backend/, before any future migration deployment:
node --use-system-ca node_modules/prisma/build/index.js migrate resolve --applied 20261024120000_social_auth_identity
```

Do not run the social-auth CREATE TABLE migration again; the table was already created successfully. The signed Play bundle remains deferred. The corrected Android test APK is `mobile/build/releases/Setcraft-google-fixed-v2.apk`, also copied to `mobile/build/releases/Setcraft-google-test.apk`.

## Android Google sign-in configuration completed

The account owner saved the Google provider. Both Firebase Console and the Firebase API confirmed it is enabled. The refreshed `mobile/android/app/google-services.json` matches the Setcraft app, contains two Android OAuth clients for its signing certificates, and contains the Web client matching the enabled provider.

`mobile/build/setcraft-google-sign-in.json` was generated with Google sign-in enabled, the verified public Web client ID, and the currently running HTTPS ngrok API origin. The backend `.env` now enables `SOCIAL_AUTH_ENABLED=true` and explicitly selects the existing Firebase project and Admin credential. The identified old backend was restarted; the replacement source server runs normally without watch mode. A local `/health` check passed, and the live `/api/auth/social` endpoint rejected an invalid token with HTTP 401 rather than the previous disabled-provider response.

The owner confirmed a successful Google login with account setup opening on the connected Android phone after the corrected version 2 update. This exercises native Google selection, Firebase authentication, the Setcraft API token exchange, and authenticated account entry. Keep the local backend and current ngrok tunnel running for this test build. A new Google identity creates a Setcraft account; an existing email/password account keeps the explicit existing-account flow. A Google login does not grant membership.

The current test APK is a debug build, version code 2, approximately 182.0 MiB. Its compiled package `com.setcraft.app`, visible label Setcraft, version, APK signature, signing-certificate match against the Firebase Android OAuth clients, and compiled Firebase app resource were verified. SHA-256: `2B00B387BA5A3BC145F84C43C8D69B3C9E06703EE75EAA6787407728F4745E15`. It was installed as an update on the authorized Android phone without clearing app data, and the correct package was confirmed running in the foreground. The release-build attempt encountered a local Java certificate-trust failure while downloading a Maven dependency. Its temporary trust-store setting was removed and the original Gradle settings restored; no release APK or Play bundle is claimed as validated.

Ordinary Android builds now enable Google using the verified public defaults in `mobile/lib/core/config/google_auth_config.dart`; special build defines are no longer required. `./tool/prepare_google_sign_in.ps1` refreshes that source configuration from the matching Firebase JSON as well as generating optional build defines. A supplied `-ApiBaseUrl https://YOUR_API_ORIGIN` sets the API origin in those optional defines. iOS stays unavailable until its own native OAuth client is configured. Never include the Admin JSON in Flutter assets or source control.

## Fixed normal-build regression

The original implementation defaulted both Google feature/client-ID defines to disabled/empty. A normal rebuild without the special define file therefore disabled the button and restored the shared Coming soon label. Version 2 uses the verified Android configuration by default, keeps explicit build overrides, and preserves the separate iOS configuration guard. A widget regression test checks the normal Android build enables Google and does not show Coming soon. The two targeted sign-in test files passed (20 tests), and focused analysis of the changed Dart files reported no issues. The public HTTPS API health check passed, and its social exchange rejected an invalid token with HTTP 401. The owner then confirmed a real Google login succeeded on the phone.

## Files needed

| File | Status and purpose |
| --- | --- |
| `mobile/android/app/google-services.json` | Refreshed after enabling Google; verified project, package, Firebase app ID and OAuth client match. This is the Android client configuration. |
| `backend/secrets/firebase-admin.json` | Already exists and its Firebase Management access was verified. No replacement is requested. Server-only private credential. |
| `mobile/build/setcraft-google-sign-in.json` | Generated and ready. Contains the enabled Google flag, public Web client ID and active test API URL, not an Admin key. |
| `mobile/lib/core/config/google_auth_config.dart` | Verified public Android OAuth defaults for ordinary builds; prevents the Google button being disabled when the optional define file is omitted. |
| `backend/secrets/google-play.json` | For later billing setup: a Play-authorized service-account credential, provisioned server-side after Play API permissions are configured. Not required for Google login. |
| `mobile/ios/Runner/GoogleService-Info.plist` | A later iOS Google/Firebase setup item for bundle `com.setcraft.app`; it is a plist rather than an Android JSON file. iOS Firebase registration and Google callback configuration are still outstanding. |

## Verification and remaining release work

Backend TypeScript build and mocked social-auth checks passed. Six relevant Flutter test files passed (60 tests). Full Flutter analysis reported no errors, with eight existing warning/informational findings in the local glass package, unrelated tests, and diagnostic tool code. Flutter also emitted existing Skia shader compatibility warnings during the passing tests.

Real Google account selection/token exchange was confirmed successful by the owner on the updated Android app. Live Play checkout has not been tested. Play currently blocks the subscription catalog until a Google Payments merchant account is set up by the account owner. Its dashboard also requires a closed test with at least 12 continuously opted-in testers for 14 days before applying for production access. Internal testing can be prepared first.

The stable production API URL, actual legal-page URLs, Play products/prices, billing permissions, and notification delivery configuration remain release setup tasks. No public release or real payment was performed.
