# Plan preview and workout overview

Onboarding shows the complete recommended week as day-by-day rows. The names,
dates, rest days, durations and exercise counts come from the saved plan. The UI
does not assign a fixed body-part split to every user.

Before access is active, the server returns at most two distinct exercises from
the first training day. Other exercise details and the full payload stay on the
server. The preview shows clear locks and the membership action. Existing trial
or membership access opens the full plan without another membership prompt.

Unlock validates the saved preview before checkout. If preferences, catalogue
data or planner rules have changed, it refreshes the unpublished starter draft,
shows progress and resumes unlock after validating the updated plan. One unlock
attempt triggers at most one automatic refresh. Refresh failures offer retry;
another context change offers an explicit refresh. Account changes stop the
flow, and automatic navigation waits until the app returns to the foreground.
The same recovery works after checkout without granting another entitlement.
Active plans remain intact and activation still checks current plan validity.

Onboarding Continue actions show a disabled “Continuing…” state immediately,
with a spinner and subdued appearance. The shared action blocks repeat taps
until both asynchronous work and the local question transition have finished.

The body illustration is available under Muscle focus. It no longer pushes the
recommended week below the first screen.

The weekly plan opens as an overview with the next unfinished workout, confirmed
weekly completion and a compact schedule. An in-progress session takes priority;
otherwise the next scheduled date is selected. Live day data supplies the actual
workout after rescheduling. Refreshing a saved week also refreshes that data.

Tapping a day opens its details. Today can be started and an existing session can
be resumed; future dates are previews. Working-set prescriptions, effort, rest
and explanations expand inside each exercise row. Food remains available in the
day view. Plan options and notes are secondary sections.

Generation uses a shared native Flutter star orb in onboarding and weekly
planning. The stars shimmer and drift around a clear central percentage. The
percentage moves only to confirmed backend progress, reaches 100 only after a
plan is saved, and pauses activity when the view/app is inactive. Reduced-motion
settings soften the star movement. A running-plan card opens progress directly;
View weekly plan opens the completed saved week without a reminder prompt.

Checks cover preview redaction and activation, two-exercise limits, day labels,
normal and onboarding workout starts, future-date previews, repeated taps,
offline state, next-workout refresh, weekly completion, history and narrow text
layouts. Visual snapshots are produced by the Flutter plan tests under
`mobile/build/previews/`.

No database migration or user-history reset is required for these changes.
