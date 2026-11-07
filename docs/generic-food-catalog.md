# Generic 300-food catalogue

The shared library contains 300 generic reference foods, including an unbranded
`Whey protein` entry. No manufacturer brands, barcodes or branded supplement
records are imported. The original 181 identities are retained so existing meal
logs and saved plans keep their original references and nutrition.

## Nutrition

`data/generic_foods.json` is generated offline by
`scripts/prepare_generic_foods.py` from the existing verified 181-food file and
the 119 explicit selections in `data/generic_food_additions.tsv`. It uses the
retained official USDA SR Legacy and Anses Ciqual source snapshots, checking
the published archive checksum and the extracted source bytes. Source code,
version, original description and nutrient values remain attached to each food.

All nutrition is per 100 g edible portion. No missing, trace-only or bounded
nutrient is turned into zero. Selected additions lacking complete records were
replaced with foods having complete sourced data. Existing source-specific
carbohydrate definitions remain explicit in provenance; USDA total carbohydrate
includes fibre, whereas Ciqual publishes carbohydrate separately from fibre.
These are reference averages, not measurements of a particular branded product.

Whey uses the generic USDA SR Legacy entry 173180. Its optional 30 g portion is an
explicit gram measurement, not a claim that every scoop weighs 30 g. Existing egg
and milk conversions retain their original sourced portion weights/densities.

New names have a precise English fallback. Existing reviewed/previously generated
translations are retained where their canonical name still matches; translations
for new names can be added separately without changing source identities.

## Photos and Cloudflare

The user-named bucket is `fitai-food-images`, with public origin
`https://pub-134bda0dd83b4c4793daf0b75e890947.r2.dev`.
Optional `R2_FOOD_BUCKET_NAME` and `R2_FOOD_PUBLIC_URL` configure the food uploader
independently of exercise/body storage. Uploads reuse existing R2 credentials.
The uploader refuses to write to a differently named bucket.

`data/food_images.json` records each selected image's original file page, author,
licence, source hash, transform, output hash and visual review. Licensed photographs
come from Wikimedia Commons and FreeFoodPhotos (CC BY 3.0, with attribution).
These images
represent foods; quantities, preparation and nutrition come from the food record.
The reviewed 512 × 512 WebP assets live in `assets/food-images/` and are capped at
180 KB each. Public object names include a content hash and use immutable caching.

Credits are published at `foods/v1/credits.html` and `foods/v1/credits.json`.
Attribution and source/licence links remain available from each food's existing
portion screen. Converted CC BY-SA photos retain their licence. Additional
original unbranded representative images is made with the built-in imagegen tool;
their prompts and provenance are retained in `docs/food-image-prompts.json` and
`data/food_generated_images.json`. Image generation never supplies nutrition data.
This work does
not redesign the nutrition screens. Source and client cache namespaces change to
avoid serving the previous catalogue after deployment.

`r2.dev` is suitable for development. Configure a custom R2 domain before using it
for production traffic, then rerun image verification with `R2_FOOD_PUBLIC_URL`
set to the stable origin and update the food URLs through the replacement tool.

## Replacement procedure

1. Run the offline preparation script with Python, then `npm run test:food-data`.
2. Collect licensed source photos with `scripts/collect_food_photos.ts`. Source
   metadata/downloads are cached under ignored `build/food-catalog/`. Respect
   upstream Retry-After delays. Resolve missing/incorrect source images explicitly.
3. Run `scripts/render_food_photos.py`, inspect every contact sheet under
   `build/food-catalog/review`, and approve only matching, usable images in the
   photo manifest. Crops or image replacements require a fresh visual review.
   Record `reviewedSha256` as the approved output's SHA-256 alongside `reviewed`;
   the loader rejects images whose bytes no longer match that approval.
4. Run `npm run test:food-data -- --photos` and `npm run foods:images` (dry run).
5. Run `npm run foods:images -- --upload`. It verifies every public object's
   content type and exact bytes, uploads the credits, and writes a receipt to
   ignored `build/food-catalog/images-uploaded.json`. `--check` verifies without
   writing to R2. Failed verification never triggers database replacement.
6. Run `npm run foods:replace` (dry run), then `npm run foods:replace -- --apply`.
   The image receipt must match the current catalogue and all image URLs/hashes.
7. Run `npm run foods:replace -- --check`, `npm run test:food-catalog`, the backend
   build and relevant Flutter nutrition regression checks.

The replacement first backs up all shared food rows. Inside a serializable
transaction it locks nutrition/meal tables, deletes obsolete unused shared rows,
archives obsolete referenced rows and installs the 300 active foods. It checks
that private foods, meal logs and saved plan items are unchanged before commit.
It does not truncate tables or cascade-delete meal history. A transaction failure
rolls back the change. Readers see the old catalogue until the transaction commits.

The backup path and row counts are recorded in
`build/food-catalog/latest-result.json`. Keep that backup until release validation
is complete. Archived history rows may mean the physical table has more than 300
rows; the shared browsable library must have exactly 300.

## Installed snapshot

On 25 October 2026 the connected database was updated from 181 to 300 active
generic foods. All 420 meal logs and 490 saved plan items were preserved; there
were no private foods to migrate. The original 181 identities were reused,
so this replacement required no row deletions or archival.

All 300 public image URLs passed content-type and SHA-256 verification before
the transaction. The optimized images total 10.42 MiB; the largest is 133 KiB.
112 food entries use original generated illustrations, with shared representative
images for some related foods. Other entries use credited source photographs.
Each image is representative; its appearance does not establish portion weight,
preparation-specific nutrition, or a branded product's composition.
