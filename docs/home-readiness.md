# Home readiness and synced readings

Home contains no health connection/setup card or connection CTA. Existing onboarding setup and automatic sync remain available. Connection management is in Settings. Tapping readiness or daily metrics shows dated readings and missing inputs.

Returning login and restored sessions open the dashboard directly. Health setup is offered only after new-account registration. A saved account-scoped enabled choice or previous sync timestamp repairs a missing local setup marker without enabling sharing for a disconnected account. Next-day sync retains the user's existing permissions and does not request authorization again.

Sync availability and a readiness score are separate. A same-day Health Connect/HealthKit snapshot can contain movement without sleep or heart measurements. Home shows those available values and identifies the missing readiness inputs instead of asking the member to connect again or substituting zeros for a score.

The existing FitAI device estimate requires positive recorded sleep plus a positive resting heart rate or HRV value. Movement alone is insufficient for this calculation. Home derives the score from the selected day's actual snapshot, so a missing legacy derived-score field does not hide valid inputs. Preview snapshots remain excluded and dates do not borrow readings from another day.

Health snapshots/history store the estimate on a 0–100 scale. Home's score contract is 0–10 and is converted back to 0–100 for its ring; labels now use the correct scale. Home cache version 12 includes the explicit wearable preference and sleep/check-in provenance. No device health records are changed by these presentation/read-path fixes.

Only accounts explicitly choosing NONE for wearable use can save the new rest/soreness answers or confirmed phone estimates. A complete check-in provides a separately labelled daily check-in estimate when measured readiness is unavailable. Wearable/UNKNOWN users do not get this fallback from missing data. Valid device readiness retains precedence; heart measurements remain absent rather than being derived from phone inactivity. See mobile/docs/phone-sleep-checkin.md for the platform and consent flow.

Validation covers movement-only sync, separate missing inputs, date isolation, score units and labels, legacy null derived scores, health-source changes, dated readiness sheets and removal of Home connection prompts.

When actual heart readings exist but synced sleep is absent, a saved sleep duration can supplement them for a separately labelled readiness estimate. The device snapshot remains unchanged, no sleep efficiency is invented, and this result is excluded from the measured recovery graph. Without heart readings, wearable users see their saved sleep and a clear missing-input message. No-wearable users can complete rest, energy and soreness for the daily check-in estimate.

Sleep save responses and Home use buildDailyReadiness for matching date/source/score logic. The save returns the persisted entry with updatedAt, saved wearable usage and readiness, allowing immediate client confirmation without depending on a subsequent Home request.
