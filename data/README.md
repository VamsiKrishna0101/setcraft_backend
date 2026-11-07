# Catalogue data and display translations

The shared food library is the [generic 300-food catalogue](../docs/generic-food-catalog.md).
`generic_foods.json` retains reference nutrients and portions; `food_images.json`
records approved image hashes and credits. Food images are served from the
dedicated Cloudflare R2 bucket. Generated representative images have their full
prompts retained in `../docs/food-image-prompts.json`; nutrition is never generated.

## Exercise catalogue and display translations

`../exercises.json` is the original source and is preserved. `exercise_catalog.app.json`
contains all 1,324 exercises with names and form guides for `en`, `de`, `fr`, `sv`,
`no`, `da`, `nl`, `es`, and `it`. `de-CH` uses standard German. Norwegian uses Bokmål.
Unsupported source translations are omitted from the prepared file and import.

Existing English/French/Spanish/Italian form guides are preserved. Added catalogue
translations and names were generated with the configured Gemini model and have
not been professionally reviewed. Preparation checks IDs, complete language
coverage, nonempty names/steps and step count/order. Review the wording before a
public release, particularly technique and safety instructions.

From `backend`:

```powershell
node --use-system-ca --import tsx scripts/prepare_exercise_catalog.ts
node --use-system-ca --import tsx scripts/prepare_fitness_copy.ts
node --use-system-ca --import tsx scripts/import_exercise_catalog.ts --dry-run
node --use-system-ca --import tsx scripts/import_exercise_catalog.ts
node --use-system-ca --import tsx scripts/translate_legacy_exercises.ts
```

Preparation checkpoints completed batches. Re-running resumes missing work.
Preparation uses the configured API and may incur translation charges. Nothing
is translated per catalogue view. A new import requires full coverage first.

The importer adds or updates by exercise code while keeping existing exercise
IDs. It never deletes plans, workout items or set logs. Canonical storage names
are disambiguated where legacy records already own the name; display names stay
natural. Existing unambiguous records without a code can be matched by name.
Duplicate existing codes stop the import. New catalogue records do not invent
calorie burn, tempo or exercise duration. Redis display caches are refreshed.

`fitness_ui.en.json` is shared UI and anatomy terminology. `fitness_ui.json` is
the translated dictionary; preparation also emits Flutter's `fitness_copy_data.dart`.
`legacy_exercise_translations.json` checkpoints translations of existing exercises
that belong to preserved plans. Canonical names, media and IDs remain intact.

API responses select the requested language and retain canonical filter values.
Catalogue, detail and plan display caches are separated by language. Existing
coaching notes are translated once per owner/language/source hash, with numbers
checked and a 30-day Redis cache. Provider failures preserve the source text.
Changing language does not generate a new plan or change measurements.

Media uses the exact JSON path relative to `EXERCISE_VIDEO_BASE_URL`; credentials
are never bundled with Flutter. `check_exercise_media.ts` checks a small set of
poster and animation URLs without printing the configured base or credentials.
