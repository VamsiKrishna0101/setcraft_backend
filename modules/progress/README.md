# Progress

Owner-authenticated read APIs under `/api/progress`. Queries take `date`, `utcOffsetMinutes` and `period` (`4w`, `3m`, `1y`, `all`). Exercise and session lists also accept `cursor` and `limit`.

`period=custom` takes inclusive `start` and `end` dates. Invalid or future ranges are rejected. APIs accept only real data; `dataset=preview` is rejected. Existing preview fixtures are excluded from user results and are preserved in the database.

- `/`: summary, consistency, muscles, exercise previews, body and wellness.
- `/exercises`: logged exercise discovery, with search and muscle filters.
- `/exercises/:id`: actual sets, records, chart series, all-time personal rank and paginated training days.
- `/exercises/:id/rank`: personal training milestones and badges, including locked badges before the first log.
- `/muscles/:id`: direct and assisting exposure, weekly trends and contributing exercises.
- `/sessions`: paginated actual session history.
- `/body`: source-separated measurements and assessment metadata; no private photo bytes.
- `/wellness`: recorded recovery and nutrition history, plus current profile-derived nutrition targets.

Calculations use recorded workout dates, not insertion timestamps. Preview sets and snapshots are excluded. Duplicate retries count once. A finished session is distinct from an exercise marked done. The first set establishes a record baseline. Estimated strength is the Epley estimate for eligible weighted sets of 1–12 reps; bodyweight, assisted, band, stretching and cardio entries are excluded. Load volume is external recorded weight × reps, not work or muscle growth.

Profile weight is a baseline, not a recurring measurement. Photo, tape and synced readings retain their sources. Missing wellness logs stay missing.

Five-minute caches include owner, locale, query and an owner revision. Workout, nutrition, health sync and body mutations invalidate that revision. `scripts/test_progress.ts` uses disposable `@example.invalid` accounts and cleans only its own fixtures. Run it with `node --use-system-ca --import tsx scripts/test_progress.ts`.

Exercise strength estimates and the Body training map use the same helper in training/strength_rank.ts and the attributed snapshot in data/strength_standards.json. References cover 13 explicitly matched free-weight movements. Other variants, machines, unsupported profile ranges, unconfirmed load conventions and fewer than two eligible days remain unranked. The five colours mean Beginner, Novice, Intermediate, Advanced and Elite; grey means unranked. Weekly set totals remain activity details, not strength inputs.

The estimate uses the second-best separate session in the preceding 90 days and an Epley estimate capped at ten reps. It compares sampled bodyweight reference rows by linear interpolation; it is not age-adjusted and does not claim population percentiles. Beginner is the lowest band, including results below the novice threshold. A muscle uses the lower median of its supported direct-exercise levels, with contributors exposed in the response; assisting exposure alone cannot award a rank. Photos and onboarding experience never determine strength levels. Source links and matching load conventions are returned for the app’s explanation sheet. Personal consistency milestones remain separate fields for backwards compatibility.

Run `node --use-system-ca --import tsx scripts/test_exercise_rank.ts` for the pure ranking rules. The progress integration script also checks the authenticated rank endpoint, account isolation, preview rejection and cache refresh after history changes.
