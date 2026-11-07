# Store subscriptions and membership access

Setcraft requires an active membership to enter the app. New eligible customers start a **14-day native store trial**, followed by the selected auto-renewing paid subscription. There is no permanent free tier or client-side dismissal that grants dashboard access.

Existing app-managed trials keep their original server expiry. They do not gain automatic billing. The old authenticated `POST /api/subscription/start-trial` endpoint returns existing access or HTTP 409; it cannot grant a new trial. No existing account data was reset for this change. Subscription verification reuses the existing gateway, expiry and trial fields. The separate `20261101170000_optional_onboarding_measurements` migration allows a training profile to be created before height and weight are recorded.

## Onboarding checkout

The completed starter plan has its own visual preview, including two real exercise samples that open the existing full exercise guide. Unlock full plan opens a separate subscription page with a short Day 1 / Day 12 / Day 14 timeline for eligible native trials and annual/monthly prices. The purchase action validates the draft and opens native store checkout. Verified access activates the plan; returning from membership keeps the same preview. Day 12 describes the remaining trial time and does not promise a notification. Missing billing setup appears inline with Retry, rather than adding another availability screen. Body measurements can be added later in Body; they are not a prerequisite for training generation.

## Required production configuration

The local configuration audit on 2026-10-24 found **no Google billing credentials, no Apple billing configuration, and neither subscription legal URL configured**. Until these are supplied and products are available, the paywall offers retry and restore rather than inventing prices or granting access. The development APK and screenshot fixtures do not prove live store checkout.

### Google Play

1. Register the current package `com.setcraft.app` or update the Android/Firebase/package configuration together before release.
2. Create auto-renewing products `setcraft_premium_monthly` (base plan `monthly`, one month) and `setcraft_premium_annual` (base plan `annual`, one year).
3. Add an eligible-new-customer offer with **one free phase of P2W or P14D**, followed directly by the recurring base-plan price. Activate plans/offers in the intended countries. Configure eligibility in Play Console; do not use a repeatable developer-defined free offer.
4. Set the USD products to **$9.99 per month** and **$69 per year** ($5.75 monthly equivalent; 42% less than twelve monthly payments). Publish and review regional prices in Console. `data/subscription_prices.json` remains a draft planning reference; changing it cannot change the store price. The app displays the localized paid renewal phase, not the zero-price trial phase. Annual savings compare real same-currency offers.
5. Enable the Google Play Developer API. Grant the service account access to the app’s subscriptions/orders and configure `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` (or application default credentials via `GOOGLE_APPLICATION_CREDENTIALS`). Firebase messaging credentials alone are insufficient. Optionally set `GOOGLE_PLAY_PACKAGE_NAME` if the package changes.
6. Set up authenticated Pub/Sub RTDN at `/api/subscription/google/notifications`. Set `GOOGLE_PLAY_RTDN_AUDIENCE` and `GOOGLE_PLAY_RTDN_EMAIL`. The endpoint verifies the publisher identity, then reads current Play state. Notification payload status never grants access.
7. Purchases use a SHA-256 account binding and are acknowledged only after server verification. Replays are idempotent; transfers to other Setcraft accounts are rejected.

### Apple App Store

1. Enable in-app purchases and create matching one-month and one-year auto-renewing subscriptions in one subscription group, with a **two-week free introductory trial** and appropriate new-subscriber eligibility.
2. Default product IDs are `setcraft_premium_monthly` and `setcraft_premium_annual`. Override with `APPLE_SUBSCRIPTION_MONTHLY_ID` and `APPLE_SUBSCRIPTION_ANNUAL_ID` only when the actual products use different IDs.
3. Configure these backend environment variables (never commit their values or private files):
   - `APPLE_STORE_ENVIRONMENT`: exactly `Sandbox` or `Production`.
   - `APPLE_STORE_BUNDLE_ID`: the actual bundle ID; the current Xcode project uses `com.setcraft.app`.
   - `APPLE_STORE_APP_ID`: numeric App Store Connect app ID, required in Production.
   - `APPLE_STORE_KEY_ID`, `APPLE_STORE_ISSUER_ID`.
   - `APPLE_STORE_PRIVATE_KEY_FILE`: path to the App Store Server API private .p8 key.
   - `APPLE_ROOT_CA_FILES`: semicolon-separated paths to official Apple root CA certificate files, obtained from Apple PKI and provisioned by the operator. Never trust a client-supplied certificate as a root.
4. Configure App Store Server Notifications V2 at `/api/subscription/apple/notifications` for the chosen environment. Signed notifications are verified, then the latest subscription status is fetched again.
5. StoreKit passes the Setcraft user UUID as `appAccountToken`. The backend uses Apple’s official server library to verify signatures, bundle/environment and account ownership, then reads current transaction and renewal status. Revoked/upgraded/expired transactions cannot grant access; verified billing grace periods use their actual grace expiry.
6. The app checks native introductory-offer duration and StoreKit 2 eligibility before displaying a 14-day claim. An old transaction’s expiry alone is insufficient to grant membership.

### Both stores

Set real public HTTPS URLs in `SUBSCRIPTION_TERMS_URL` and `SUBSCRIPTION_PRIVACY_URL`. Billing is disabled until both exist. The purchase footer shows the total renewal price, billing period, auto-renewal/cancellation terms and restore links. If an offer or price changes before checkout, the user must review the updated offer and tap again.

Purchase cancellation, pending payment, store outages and failed verification leave membership locked. Only a current server-confirmed entitlement unlocks it. The gate rechecks on foregrounding and periodically, including detail routes opened before expiry. Privacy/data export, photo deletion, account deletion and sign-out remain reachable through More options in the paywall footer. Canceling a store subscription is separate from deleting a Setcraft account.

## Verification before public release

- Android: upload a signed bundle to an internal Play test track, add license testers, and install from its test link. A sideloaded debug APK is not a complete billing test.
- Apple: use App Store Connect sandbox/TestFlight on Apple hardware. This Windows development environment cannot build or validate a signed iOS app.
- Test eligible and ineligible offers, both billing periods, cancellation, pending payment, offline/failed verification, restore/reinstall, renewal, grace/hold, expiry, refund/revocation and account transfer rejection.
- Ensure the always-running notification worker is configured if trial reminders are enabled. Reminders depend on opt-in/delivery; the paywall does not promise a guaranteed Day 12 notification. Existing Android reminders distinguish native auto-renewing trials from legacy cardless trials.
- `npm run build` and `npm run test:subscription` exercise backend state transitions and authenticated API guards. The test creates disposable example.invalid accounts and deletes them afterward. It performs no real charge. Apple lifecycle fixtures enter only through the test adapter; production verification has no fixture or unsigned fallback.

Primary implementation references: [Google subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions), [Google subscriptionsv2 API](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2), [Apple server library](https://github.com/apple/app-store-server-library-node), [Apple subscription status API](https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses), [Apple PKI](https://www.apple.com/certificateauthority/).
