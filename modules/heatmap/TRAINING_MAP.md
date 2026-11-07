# Live training map

`GET /api/heatmap/training?date=YYYY-MM-DD&utcOffsetMinutes=330` requires authentication.
`PUT /api/heatmap/check-in` accepts muscleId, soreness (0–3), date and utcOffsetMinutes.
Check-ins are restricted to the caller's current calendar day and keyed by user/muscle/date.

The map works without scans. Only actual logged sets from USER workout items count;
FITAI_PREVIEW records and completed-item flags do not create inferred sets. Primary
muscle tags take precedence over broad categories and exercise-name fallbacks.
Secondary exposure is reported separately. Unknown exercises remain unmapped.

Weekly targets come from the newest active reusable schedule, or a completed plan
created within the displayed week. Date fields on set logs define their calendar day.
Repeated item/date/set-number entries count once. Load trends show the highest
recorded weight per day for the same exercise, with reps; they are not strength scores.

The Training map colours show estimated exercise-strength bands: grey is unranked,
then bronze Beginner, gold Novice, green Intermediate, blue Advanced and purple Elite.
The shared helper in progress/training/strength_rank.ts also drives the exercise Rank
screen. Its attributed reference snapshot covers 13 explicitly matched free-weight
movements; variants and machines without a matching reference stay unranked.

The estimate needs positive logged loads and explicit weight conventions within
90 days. One qualifying training day gives a labelled provisional estimate; a second
day confirms it. Bodyweight-specific reference rows are interpolated inside their supported
range. The second-best session confirms the result; repetitions above ten are capped
in the Epley estimate. References are not age-adjusted and are not population norms.
The lowest band includes results below the novice reference. An area's colour uses
the lower median of confirmed direct-exercise levels, falling back to provisional
levels only when none are confirmed. Provisional strength badges remain locked.
Contributors are returned for
the detail sheet; secondary exposure alone never awards a rank. Photos and onboarding
experience do not set these levels. This is an exercise-based proxy, not an isolated
muscle-strength test.

Weekly direct sets, planned targets and soreness remain separate activity details.
Day includes only the selected calendar day. Week includes Monday through the
selected date (the displayed range); planned targets cover that whole week.
Only direct exercises actually logged in the selected period contribute map
colours. Their levels still use the same 90-day, as-of-date strength calculation;
an empty day is grey without deleting previously earned exercise levels.
Muscle session lists, load trends and unmapped exercise notices use the selected
period too. Last-trained dates and the explicitly labelled previous-week counts
remain historical context. Dated skipped workouts/rest days suppress reusable
schedule targets; schedules created later cannot fill earlier days retroactively.
Exposure dates do not imply physiological recovery. The anatomical illustration is
a guide, not the user's measured body shape.

New onboarding fields persist priorities, selected days, preferred time, limitation
notes, food allergies/dislikes and an optional currency-aware budget. Priorities and
limitations affect the live map; nutrition details are stored for future meal planning.
They do not retroactively rewrite existing plans. Existing members can edit preferences
from Body or Profile. Check-ins are included in account export and cascade on deletion.

Validation: `npx tsx scripts/test_training_map.ts`,
`npx tsx scripts/test_training_map_integration.ts`, `npx tsc --noEmit`, Flutter tests.
The integration check makes authenticated read requests and rolls back all synthetic
database writes, leaving the existing member's records untouched.

Product references: [Hevy's muscle distribution and set-count guide](https://help.hevyapp.com/hc/en-us/articles/35702030346903-Hevy-Statistics-Explained-Track-Your-Training-Progress-and-Muscle-Growth)
and [Fitbod's separate recovery estimate](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery).
FitAI's current implementation uses logged counts, scheduled quantities and check-ins;
it does not implement Fitbod's physiological recovery model. Strength reference sources and
load conventions are recorded in data/strength_standards.json and exposed in rank details.

## Body plan and training view

GET /api/heatmap/body uses one selected calendar week. Its targets come from the
effective dated schedule exposed by the planned map, including edits, rest days,
skips and rescheduling. Logged direct and assisting sets come from real training
history. It never equates the weekly-plan ID with a reusable workout ID.

Current weeks include logs through today; historical weeks include Sunday; future
weeks have zero logged work. Only direct sets advance a direct-set target. The
Body app uses planned, in_progress and completed states for blue, amber and mint.
Assisting work remains separate, and no strength or recovery is inferred.

Validation: scripts/test_body_map.ts and scripts/test_body_measurements_api.ts.


### Exact training date selections

The Body endpoint accepts one optional training selector alongside its date and UTC offset: `from=YYYY-MM-DD` for an inclusive range ending on `date`, `dates=YYYY-MM-DD,...` for up to 366 exact nonconsecutive dates, or `all=true` for all recorded history through `date`. Selectors are mutually exclusive; invalid or future training endpoints return 400. Without a selector, the existing weekly plan contract is preserved.

Training totals use deduplicated valid logs on the selected dates. The original training endpoint keeps day/week behavior. Body now retains strength evidence, history and trends, and supplies catalog exercise IDs for direct exercise navigation. Each exercise includes a preview of its 12 most recent selected sets; the exercise screen owns complete history. Trained colors describe direct/assisting logged exposure, independently of plan progress. Photo estimates remain excluded from measurement progress and planner baselines.
