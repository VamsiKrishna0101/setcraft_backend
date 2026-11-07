# Notifications

Authenticated preferences and installation registration, persistent PostgreSQL jobs, FCM/APNs delivery and Flutter routing for Setcraft (`com.setcraft.app`). Device-local rest timers are independent of remote delivery.

## Setup

- Server Firebase credentials: `backend/secrets/firebase-admin.json`, an absolute `FIREBASE_SERVICE_ACCOUNT_FILE`, or application-default credentials. Keep server keys out of the app.
- Android Firebase client: `mobile/android/app/google-services.json` with the `com.setcraft.app` client.
- Apply the notification migration before starting the updated backend. Production deployments use `npx prisma migrate deploy` after reviewing pending migrations.
- Keep the backend running: `npm run dev`, or `npm run build` then `npm start`.
- `NOTIFICATIONS_DISABLED=true` disables remote workers/delivery without removing preferences.
- iOS signing and Firebase steps: [notifications-ios-setup.md](../../../mobile/docs/notifications-ios-setup.md).

## Preferences and delivery

Remote notifications start disabled. After explicit opt-in, workouts, plans and billing are selected; check-ins, meals and summaries remain optional. The invitation appears after successful plan generation. Settings shows selected times, the next planned workout reminder, quiet time and a seven-day coaching pause. Account reminders stay active during a pause while the master switch is enabled.

Workouts require unfinished real activity. Check-ins require missing self-report and no wearable. Meals target missing logs. Sunday recaps require completed training in their seven-day period. Plan availability uses the planner's actual calendar/cooldown calculation. Trial copy follows subscription source and cancellation state; trial reminders target both Android and iOS registrations.

At most two automatic routine notifications send per local calendar day. An unfinished workout gets a reserved slot; Sunday recaps also take precedence over low-priority reminders. Saved-plan and billing messages have separate budgets. Explicit tests and fifteen-minute workout snoozes bypass coaching pause, quiet time and routine budgets, but still require enabled account/category preferences.

Automatic reminders inside quiet time move to the end of that quiet period. The original activity date is retained across midnight, so taps open the correct workout/check-in/meal/report period. Routine jobs expire one hour after enqueue; saved-plan jobs after 24 hours; tests after five minutes. Activity completion is checked again before delivery.

Scheduling processes indexed due-user batches every ten seconds, checking each user about once per minute. Dispatch runs separately every five seconds, drains batches concurrently across users and keeps each user's jobs sequential. Separate PostgreSQL advisory locks prevent competing dispatchers from defeating daily limits. These are dispatch intervals, not exact phone-delivery promises.

Event keys, sending leases and collapse identifiers reduce duplication. Transient failures get at most three transport attempts; only failed devices are retried, and invalid tokens are removed. Jobs record priority, skip/defer reasons, first provider acceptance and account-scoped open timestamps. `SENT` means at least one provider acceptance, not confirmed phone display. Finished jobs and inactive registrations are pruned after 90 days; devices unseen for 60 days are excluded from delivery.

## Device behavior

Android channels separate reminders, progress insights, account updates and rest timers. Workout/test pushes use high priority. Local rest alerts request notification permission only when explicitly enabled. Android precise-alarm access is an optional separate action; without it, scheduling falls back to inexact delivery. Rest alerts reschedule/cancel on extend, pause, resume, skip, finish and sign-out. Foreground timers retain the existing in-app timer/haptic.

Taps verify account ownership. Lock-screen copy excludes measurements/photos. Sign-out unlinks the installation and cancels local timers. Notification data, including open timestamps, is included in privacy export and deleted with the account.

## Checks

- `npm run build`: TypeScript compilation.
- `npm run test:notification-policy`: isolated policy regressions with mocked database methods and a fake sender. No database or real push is used.
- `npm run test:notifications`: existing integration suite using temporary database accounts and a fake sender; requires database access and cleans its fixtures.
- `flutter test --no-pub test/notification_settings_test.dart`: consent, preferences, rest controls, pause/resume, accessibility and preview rendering.
- Before release, verify cold-start taps, token refresh, OS permissions, locked-phone rest timers, Doze and signed iOS/APNs delivery on devices.
