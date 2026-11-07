# Nutrition, saved meals and repeat routines

Food is managed in Nutrition, reached from Today. Today also has an Add meal action. Train continues to show workouts. The active Weekly Plan's Food tab reads the same dated meals as Nutrition, so food-only refreshes and routine changes are visible there immediately. Historical plan views retain their saved payload.

## Food support

- **Keep my routine** is the default. Repeat saved meals on selected weekdays.
- **Suggest meals for me** keeps routine slots and asks the nutrition agent to fill the selected remaining slots.
- **I'll track myself** keeps daily targets and manual food logging, without generating a food schedule.

Food support and the chosen meal slots are available in Nutrition → Meals & routine. Saving an active routine while manual tracking is selected switches support back to routines. An AI user keeps AI support.

## Saved meals without photos

Create meal is available in the food library and in Meals & routine. A user supplies a name and either food portions or known calories, protein, carbs and fat for one portion. Fibre is optional. No image is requested. Nutrition is never inferred from the name.

The server checks each component's ownership and availability, computes its nutrients, and saves a private Nutrition row with category MEAL and a one-portion basis. The component snapshots and whether fibre was supplied are retained in sourceDetails. Saving does not add intake.

A routine selects a saved meal, portions, meal slot, start date and at least one weekday. It can be edited, paused or removed. Active routines cannot overlap another routine in the same meal slot on the same weekday.

## Planned versus eaten

UserMealOccurrence stores a decision for a particular calendar date and source key. It snapshots the food portions and nutrients. Planned meals contribute no consumed calories or protein until confirmed.

- Log meal creates dated UserMealLog records and marks the occurrence logged in one transaction.
- Confirming again returns the existing result. A per-user database lock also protects simultaneous requests.
- Skip records a decision without intake.
- Change this day replaces only that occurrence; the repeat template is preserved.
- Restore removes an unlogged override or skip.
- Logged snapshots remain visible after a template is edited, paused or removed. To change a logged meal, remove its diary entry first.
- Future food cannot be confirmed. The supplied IANA timezone is validated. The mobile UI offers confirmation only for today.

Meal logs retain the nutrient snapshot at confirmation. Existing logs, plan items and all 300 shared catalog records are preserved by the additive migration.

## Planner integration

The snapshot includes food support, selected meal slots and the week's routine meals. The nutrition agent uses the reviewed generic 300-food catalog, with automatic planning restricted to eligible preparation states. Raw meats, uncooked grains, flours and similar ingredients are excluded from automatic suggestions. Whey and soy protein powder portions are bounded to 15–40 g.

In AI mode the prompt includes exact remaining slots and targets after routine meals. The validator checks dates, slots, food availability, portions, nutrient arithmetic and fixed routine servings. User-selected routine meals are preserved when AI suggestions cannot be made. Nutrition-provider failures return available routines without discarding valid workout planning. The prompt version is `weekly-v12-food-routines`.

Refresh this week's food runs the nutrition agent independently. It neither creates a WeeklyPlanRun nor changes the workout generation allowance. Persistence rechecks settings, routines and catalog nutrition after generation, and preserves confirmed items and dated decisions. Concurrent refreshes use a short per-user Redis lock.

## API

All routes are authenticated beneath `/api/nutrition/me/food-planning`; mutation subscription rules match existing nutrition routes. Reads are private and not cached by intermediaries.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / PUT | `/settings` | Food support, slots and timezone |
| GET / POST | `/meals` | Private saved meals |
| GET / POST | `/routines` | List or create repeat routines |
| PUT / DELETE | `/routines/:id` | Edit or remove an owned routine |
| GET | `/day/:date` | Dated planned meals and decisions |
| POST | `/day/:date/action` | LOGGED, SKIPPED, REPLACE or RESET |
| POST | `/suggest` | Food-only refresh for a Monday weekStart |

Private meals, settings, routines and occurrences are included in the user's data export. New relations cascade during account deletion. Mobile preview mode disables mutations and does not load real dated plans into sample nutrition data.

## Database and checks

Migration: `20261025150000_nutrition_routines`. It adds three tables and a nullable occurrence reference on UserMealLog. Generate the Prisma client after applying it. Review pending migrations before deploying; no catalog replacement, truncation or reset is part of this feature.

Backend checks:

```text
npm run build
npm run test:food-planning
node --use-system-ca --import tsx scripts/test_weekly_planner.ts
```

The food-planning integration test uses temporary accounts, tests ownership, portions, photo-free meals, duplicate confirmations, dated changes, skips, routine edits, partial AI confirmations and provider fallback, then verifies that the catalog and existing log/plan counts are unchanged. Flutter coverage is in `food_planning_test.dart` together with the existing nutrition and food-library tests.
