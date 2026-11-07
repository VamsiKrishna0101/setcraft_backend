# Weekly personal planner

## Coordinated coaching (weekly-v13-openai)

The current flow is **prepare → regional specialists → assemble → whole-week review → nutrition → validation → save**. Experience and environment policies are composed with each regional prompt. Eligible candidates are ranked by recorded familiarity, previous programme choices, selected priorities and practical fundamental movements; gender alone does not change ability or muscle priorities. Beginner eligibility rejects unsupported advanced variations and unfamiliar bodyweight pull-ups/dips. Catalogue metadata and these selection policies still require qualified exercise review; name-based classifications are not clinical assessments.

The weekly reviewer sees the combined draft, regional constraints, actual performance and a compact eligible catalogue. It can replace a region's complete assigned week through structured, validated repairs. Deterministic quality checks require assigned-region coverage, knee/hip and horizontal/vertical pulling coverage when eligible equipment permits, and bounded direct/indirect workload. Indirect set credits are a programming heuristic, not a physiological fatigue measurement. Invalid review responses use the model adapter's bounded retries; an unavailable reviewer either retains a checked draft or attempts a checked rules repair. Final validation repeats the quality checks. Regional time overruns now request a repair instead of silently deleting movements or shortening rest/reps.

Provider-call concurrency is bounded independently of graph execution. The worker retains graph concurrency three; fixture checks verify completion with provider limits one and three. Do not set graph concurrency one to serialise provider requests: the installed graph runtime can return a prepared but unfinished state. `requireCompletedPlan` explicitly rejects partial graph results; a rules fallback still has to pass the normal checks. Optional live-test diagnostics report only failure categories/contract issues for fictional profiles, never credentials or raw provider responses.

Time budgets reserve an achievable introductory prescription before distributing remaining time by movement demands and granular focus muscles (including glutes and lats). Short upper/lower sessions rotate an accessory instead of squeezing all five upper-body regions into twenty minutes. Explicit splits that cannot fit appropriate work/rest fail with `INVALID_SPLIT` and an actionable preference change.

New weighted exercises start without an invented kilogram target. Completed sets and logged effort guide reps-first progression. Two complete, manageable sessions at the top of the exercise's rep bracket can permit a bounded load increment. Adapted beginners can build working sets within the weekly budget; missing effort holds progression. Equipment increments remain conservative defaults until actual inventory is collected. Bodyweight compounds support a wider rep bracket. Timed holds/carries and assistance-load exercises remain excluded because the workout logger still represents rep-counted work.

The previous active/archived week supplies programme memory, stored in the existing plan JSON: approach, start date, last known training date and anchor exercise IDs. No new database column or migration is required. Missing records do not establish a break from training. Completed workout logs feed the next explicitly generated week; this change does not enable unattended scheduling or modify a session already in progress.

Provider outages and invalid model contracts can produce a validated rules-based weekly fallback as well as a starter fallback. It uses capability-filtered, ranked fundamentals and complementary patterns rather than bodyweight-first/database-ID selection. Normal weekly fallback preserves history-based loading; starter fallback leaves starting loads unset. Rules plans are labelled, contain no invented food recommendations, and cannot bypass stale input, catalogue gaps, declared limitations or publication protections.

Exercise reasons retain concise qualitative coaching with a grounded fallback. Numeric prescriptions and progression text are controlled by the validated backend. Existing food arithmetic, allergies/diet checks, subscription enforcement, worker fencing, checkpoints and publication transactions remain in place. Meal frequency remains the existing four-slot format; no new medical nutrition policy is introduced.

Run `npm run test:planner:coaching` for isolated profile/scenario, progression, privacy, whole-week repair, continuity and graph checks. It does not read accounts or write records. Add `-- --live` to exercise the configured OpenAI model on fictional gym/home profiles (API usage applies); live evaluations do not publish plans. `npm run test:planner:starter` checks fallback and preview privacy. The legacy integration suite writes isolated temporary accounts and must be run only against an appropriate test database. Automated checks are not a substitute for qualified trainer assessment or outcome evaluation.

## Onboarding starter plan

Authenticated new accounts can request one starter plan through `GET/POST /api/plans/starter`, before starting their trial. The server locks the user row and reuses one marked run across devices; failed generation has at most three worker attempts. Existing members continue through the regular planner. Starter dates cover seven days from the request date rather than requiring a Monday start.

The existing graph creates the real plan from the saved profile, schedule and catalogue. Starter model calls use a 120-second timeout and one attempt per node. Provider outages or malformed model output can invoke a deterministic catalogue fallback, labelled rules-based in the preview. The fallback respects available equipment and the split, leaves weighted starting loads unset, and never invents food recommendations. Under-18 profiles, declared movement limitations and catalogue gaps are not bypassed by fallback generation.

Completed starter plans stay `DRAFT`. All read endpoints redact the full starter payload without subscription access; the public preview contains dated session names, actual muscle-group counts and at most two distinct exercise samples. Region tags come from the validated catalogue, never from a display-name guess. The app shows clear muscle headings with exercise samples, blurred placeholders for locked details, an expandable weekly schedule and a silver 14-day trial presentation. Only an explicit trial tap starts access. Once access is confirmed, activation rechecks current planning inputs and publishes upcoming sessions. Retries reuse the existing trial dates. The review screen before registration lets the user confirm or edit onboarding answers.

Validation: `node --use-system-ca --import tsx scripts/test_starter_plan.ts` runs pure fallback/privacy checks; add `--integration` for isolated temporary account checks against the configured database. The backend and planner worker must run this version before shipping the updated mobile flow. No new database migration is needed for starter runs.

`POST /api/plans/starter/validate` checks ownership and freshness before the explicit trial request. A stale preview does not consume trial time. Before trial start, a changed draft can be refreshed through the same starter run, within its three-attempt allowance; an unchanged draft is reused. Activation still repeats freshness validation after access is granted.

New plans (`weekly-v6-exact-set-targets`) return an exact rep target and load for every set. Equipment increments, completed sessions, actual reps and optional logged effort govern progression. Two complete sessions with reps above the old target and manageable effort are required before increasing load; missing effort, incomplete sets, missed targets and poor recovery hold or reduce the load. A historical best is not permission for an automatic 20-to-25 kg jump. New loads are estimates, never proof of lifting capacity. Gender and body photos do not establish strength.

`UserWorkoutItem.setTargets` preserves these prescriptions and their loading basis/unit when publishing and starting a workout. Editing exercise targets clears outdated per-set prescriptions. Suggested sets remain separate from actual logs. Apply migration `20261012220000_workout_set_targets` before deploying this version. Existing saved plans and logged results are retained.

Before generation, the client can offer **Add measurements** or **Continue without measurements**. Existing saved entered readings are reused; re-entry each week is unnecessary. Cancelling does not generate a plan. The weekly planner never loads photo bytes, photo observations or image-derived measurements. Independent measurement dates/sources prevent a new weight-only entry from hiding older tape readings. Photo review remains a separate optional feature. Workout history uses the preceding 21 completed local days.

The TypeScript LangGraph workflow uses seven regional OpenAI agents, a whole-week reviewer, a food selection agent and backend assembly/validation. Each exercise agent returns dated sets, reps, loads, effort and rest. Nodes receive frozen database context; they cannot write logs or create catalogue entries. The last 21 completed local days are collected using actual workout dates, not insertion timestamps.

## Code layout

`graphworkflow/graph.ts` explicitly registers every node and connects it with `addEdge`. Seven parallel exercise agents join before coordination, then food recommendations and final validation run in order.

Each file in `graphworkflow/nodes` owns its node's logic. Chest, back, legs, shoulders, biceps, triceps and core each have their own prompt and model call. The nutrition node owns its food prompt and portion calculations. Prepare loads the snapshot, creates the requested split and writes shared agent inputs. Validation combines the results and checks the final structured plan.

`graphworkflow/common` has five shared files: `types.ts` (Zod schemas), `state.ts` (run state/reducer), `model.ts` (OpenAI structured-output adapter), `prompts.ts` (shared rules only) and `catalog.ts` (metadata/equipment/diet rules). `state.ts` merges regional updates without losing parallel results. State is isolated per run, never shared across accounts. Progress reporting lives beside the graph and worker.

Prompt version `weekly-v3-personal-prescriptions` distinguishes the new schema and prompts. Existing saved plans remain stored. Interrupted checkpoints from the older workflow fail with `WORKFLOW_UPDATED`; generating again creates a request under the new context hash rather than mixing old and new agent outputs.

Training preferences store `AUTO`, `FULL_BODY`, `UPPER_LOWER`, `PUSH_PULL_LEGS`, `MUSCLE_FOCUSED` or `CUSTOM`. Custom preferences map selected weekdays to muscle regions, including combinations such as Biceps + Triceps or Chest + Legs. Prepare assigns actual dates and per-region time/slot budgets. Agents see the whole split to account for assisting exposure, and validation rejects exercises outside their assigned day/region.

Every regional agent receives its complete eligible, ranked database catalogue. The whole-week reviewer receives twelve ranked options per region plus proposed exercises and at least one representative of every available movement pattern. Compact fields include ID, name, equipment, difficulty, movement pattern, primary/secondary muscles, prescription rules and estimated duration. Instructions, media URLs and full database rows are excluded. Impact is explicitly unknown because the database does not record it. The food agent similarly receives compact per-100g nutrient metadata and all eligible reviewed foods, without images.

## What it produces

Every workout has ordered exercise IDs, exact per-set rep targets, recorded or unset loads, loading basis/unit, target RPE, rest, alternatives and grounded reasons. Suitable familiar exercises remain available for continuity. New weighted movements keep starting loads unset; the estimate enum is retained for older saved plans. Legacy logging conventions remain `as_logged`. Equipment increments are conservative defaults; the app cannot verify a gym's actual available weights. Sparse history produces an introductory dose and holds load until sufficient effort and completion evidence exists.

Entered body measurements retain independent dates and sources. Image-derived values and guidance are excluded. Whole-arm circumference is not interpreted as an isolated biceps/triceps measurement. Missing wearable readings are not fabricated. Circumferences do not establish muscle weakness or physiological recovery. Recent muscle check-ins also lower effort for exercises involving that muscle, including secondary involvement in compound movements.

Food selections reference reviewed, existing 100 g food records. Backend code fits bounded gram portions and computes nutrients. Suggested foods are pending recommendations, never logged consumption. Catalog stock/prices are unverified. Allergy profiles, unsupported diets, unsuitable energy estimates or infeasible portions return an explicit nutrition `NEEDS_INPUT` status instead of guessed meals. Specific injury/limitation profiles require reviewed exercise selection; the current automatic planner does not support them.

The training policy is an initial conservative product policy, not a medically validated prescription. Its bounds and defaults require evaluation with qualified reviewers before broad unattended rollout. General training background: [ACSM's 2026 resistance training update](https://acsm.org/resistance-training-guidelines-update-2026/).

## Persistence and execution

`WeeklyPlanRun` is the durable queue and immutable input snapshot. A PostgreSQL checkpointer stores node progress in `fitai_planner_checkpoints`. Workers claim rows atomically, heartbeat a lease token, resume checkpoints and prevent an expired worker from publishing a second result. Generation concurrency is three nodes and one run per process. Provider/contract repairs are bounded; failed runs do not replace the current plan.

On retry, the worker restarts the explicit graph edges with the same frozen input and saved regional results. Completed exercise agents reuse their output, while failed and unstarted agents execute. This avoids partial channel writes from an aborted parallel step leaving the join incomplete.

`WeeklyPersonalPlan` stores versioned structured payloads and prompt/rule/model metadata. A successful real generation automatically publishes dated `UserWorkout` items and pending `UserMealPlan` food rows in the same transaction as completion. Fresh preferences/history/catalog are rechecked. Started sessions, logged sets and confirmed meals block replacement; the whole completion rolls back and does not start a generation cooldown. The legacy activation endpoint remains idempotent for active plans. Mobile refreshes Today, Train, Body and nutrition after completion. Food suggestions never become consumed meals automatically.

Checkpoint rows have cascading foreign keys to runs. Deleting an account deletes both its planner records and checkpoints; an in-flight worker cannot recreate checkpoints after deletion. Exports include saved weekly plans and isolated demo weeks. Server logs contain run IDs/error categories, not photos, prompts or health values. Snapshots contain no photos, account email or name in model input.

## Run locally

1. Install backend dependencies and apply Prisma migrations/generate the client.
2. Configure `OPENAI_API_KEY`, `OPENAI_BASE_URL=https://api.openai.com/v1`, and `OPENAI_MODEL=gpt-6-luna`. See [OpenAI migration](openai-migration.md).
3. Start the backend. The worker runs with the server; no paid LangGraph hosting is required. OpenAI usage follows the configured account's pricing/quota.
4. Rebuild the mobile app for the new native timezone plugin.
5. Choose your training style in **Training preferences**, then open the weekly planner from Train or Body → Physique and generate. The validated week automatically becomes the active schedule; open the result to review each day.

The first planner run initializes checkpoint tables and their foreign keys; the configured database role needs schema/table creation privileges for this setup. Deployment should initialize these tables before accepting requests. Persistent snapshots/checkpoints contain personal data and belong in the same protected database as the application, with a defined deployment retention policy.

## API

All endpoints use strict authentication and only the signed-in account's ID:

- `POST /api/plans/generate`: `{ weekStart, timezone }`, returns `202` and a run ID. `includeDemo: true` is rejected.
- `GET /api/plans/runs/:id`: status/stage, confirmed progress, retry eligibility and the completed plan.
- `POST /api/plans/runs/:id/retry`: bounded retry of a failed run.
- `GET /api/plans`: recent saved versions.
- `GET /api/plans/history?cursor=<plan-id>`: twenty saved-week summaries per page, newest first, with a next cursor. Summaries include training-day count and whether a food plan is included; full payloads load only when opened.
- `GET /api/plans/saved/:id`: one complete saved plan for the signed-in owner.
- `POST /api/plans/:id/activate`: validates and publishes a real draft.
- `GET /api/plans/demo`: legacy endpoint returning an empty list; production demo generation is disabled.

Generation is currently triggered explicitly from the screen/API. An automatic weekly scheduler is not enabled.

Generation opens a dedicated mobile screen with a native teal particle halo and a confirmed percentage. Progress counts twelve milestones: history, seven regional agents, workout coordination, food planning, validation and database saving. Parallel updates merge atomically into the run's JSON progress, fenced by the worker lease. Duplicate reports are idempotent and retry retains completed milestones. The screen does not simulate elapsed-time progress; 100% requires a completed run with its saved plan.

The screen polls while visible, stops polling and decorative motion in the background, supports reduced motion, and lets users return to the planner while generation continues on the server. Pending runs expose **View plan progress**. Completion opens review of the automatically published plan.

Successful plan saves start a rolling seven-day generation limit for that account. Draft activation, selecting another week, changing preferences and changing timezones do not reset it. Failed requests do not start the limit. Request, retry and completion checks use the same user row lock, so parallel requests or previously queued jobs cannot save a second plan during the limit. Re-saving the same completed run remains idempotent.

`GET /api/plans/availability` returns the current eligibility, latest saved plan ID, pending run and `nextGenerationAt` as a UTC timestamp. The app displays this in the phone's local timezone. Body keeps the Training / Physique sections, with the weekly planner card near the top of Physique; Train also exposes this card. Saved-week review uses a day selector with separate Workout and Food sections. A saved plan remains available for review and activation during the generation limit.

The planner's **Plan history** entry opens a separate silver-card archive with week dates, Active/Saved/Archived/Test badges and workout/food summaries. **See older weeks** loads another page. Opening a card returns to that specific week's review, without generating or activating anything. Past drafts remain viewable and do not offer activation. Selecting history does not change generation eligibility.

## Real history and first-time planning

The app has no test-history switch. The API and snapshot loader reject `includeDemo: true`; the compatibility `/demo` endpoint returns an empty list. New users can generate from their actual onboarding profile and equipment even with zero logged sessions. Missing history remains empty. Initial workouts use fewer sets, moderate effort and an unset starting load for weighted exercises until the member records one. Bodyweight exercises retain their own loading convention. Missing wearable and photo measurements are never substituted with sample readings.

`scripts/remove_planner_demo_data.ts` audits or removes explicitly marked demo data only for the member who requested cleanup. Real plans, logs and profile data are preserved. Legacy synthetic drafts remain non-activatable.

`scripts/test_weekly_planner.ts` keeps history fixtures in memory and exercises first-time planning, real-only requests, prescriptions, nutrient math, invalid output rejection, owner isolation, versioning and activation with an isolated temporary user that is deleted afterward. `scripts/test_phone_sleep_checkin.ts` also verifies committed saves return during a cache outage.

See [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) and [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs) for the framework/provider contracts.
