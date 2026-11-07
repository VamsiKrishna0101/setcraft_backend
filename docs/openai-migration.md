# OpenAI migration: GPT-6 Luna

Active AI workloads use the shared Responses transport in utils/openai_client.ts: weekly planning/review, food suggestions, body coaching, photo review, coaching localization and catalog preparation. Default model: gpt-6-luna. Saved historical model provenance remains intact.

## Configuration
Use the private backend .env file; see .env.openai.example:
- OPENAI_API_KEY: a direct OpenAI project key.
- OPENAI_BASE_URL=https://api.openai.com/v1
- OPENAI_MODEL=gpt-6-luna
- OPENAI_REASONING_EFFORT=high

Optional overrides: OPENAI_PLANNER_MODEL, OPENAI_PHYSIQUE_MODEL, OPENAI_TRANSLATION_MODEL and OPENAI_FOOD_TRANSLATION_MODEL. Translation preparation uses low reasoning. An optional OPENAI_PLANNER_FALLBACK_MODEL applies only to transient failures; otherwise retries retain the selected model.

Requests use /responses, store:false, low output verbosity, timeouts, and strict JSON output. A result envelope supports array roots. Optional wire fields become nullable, then regain their original semantics before local validation. Refusals, incomplete output and missing responses are rejected. Requests and upstream error bodies are not logged; redirects are rejected.

## Planning
- Automatic beginner plans with two or three days use full body. Explicit splits remain explicit.
- Today's recovery check-ins are frozen alongside 21 completed days of workout history.
- Selections and alternatives share limitation checks, including movement metadata. Recognized explicit English exclusions such as "do not train shoulders" also exclude assisting work and remove unsupported regions from the schedule. Other free-text notes remain coach context; this is not complete natural-language or medical interpretation.
- Two complete manageable sessions at the top of the rep bracket can support one equipment increment, capped at 10%. Unknown effort, missed targets, mismatched units and reduced recovery still block increases. Equipment steps are defaults because exact available increments are not collected.
- Short qualitative model reasons are retained within the 160-character contract, with a grounded fallback. Progression is rebuilt from validated loading decisions.
- Prompt and rule versions were advanced to invalidate old in-flight checkpoints.

## Body reports
Review and refresh requests identify analysisProvider:"OPENAI". Old provider consent cannot authorize a new report. Mobile copy names OpenAI and report refresh requests fresh agreement. Historical reports remain readable. New timing metadata uses aiMs; mobile also reads the old timing key for existing scans. Photo observations never establish lifting ability.

## Verification deferred
Final build, tests and live evaluation are deferred at the user's request. The earlier direct OpenAI access probe returned HTTP 401 invalid_api_key. A valid direct OpenAI project key is needed before live evaluation. No deployment or additional APK build is included.

When authorized, start with the offline client/planner/body suites, then opt-in fictional-profile live evaluation. Database integration suites need a suitable test database because they create temporary accounts.

References:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/images-vision
