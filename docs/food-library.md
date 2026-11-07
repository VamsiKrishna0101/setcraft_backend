# Add Meal food library

The current [300-food generic catalogue](generic-food-catalog.md) includes reviewed representative images and unbranded names. The original quantities, private photos and four browsing sections are documented in [everyday-foods.md](everyday-foods.md).

Add Meal opens a dedicated screen. Food selection opens a portion screen; Custom Meal opens its form immediately, even if catalogue loading is still in progress. Successful saves return to Nutrition and refresh the daily intake.

`GET /api/nutrition/catalog` requires authentication. It returns `data.foods`, `page`, `pageSize`, `total`, `totalPages` and `hasNextPage`. The mobile app requests 24 records per page; the API caps page size at 48. Stable name/ID ordering prevents duplicate items between pages. PostgreSQL indexes support name/brand search, category and owner filtering.

Filters support category, search, nutrition focus and library/private-food scope. Search words match independently, with literal wildcard escaping. Protein focus means at least 15 g per 100 g; fibre focus means at least 3 g per 100 g; lighter foods means up to 100 kcal per 100 g. These filters use normalized values and apply only to foods measured in grams. Sort options are name, protein and calories; nutrient sorts use the same per-100-g basis. Private foods are constrained to the authenticated owner.

The portion screen accepts grams for gram-based foods and converts them to the backend serving multiplier. Other units retain the stated serving unit and use servings without guessing density or portion weight. Custom foods keep user-entered label/recipe values and do not invent missing macros.

Food preferences save eating style, allergies and disliked foods through the existing profile PATCH route. They are profile preferences, not certified ingredient/allergen filters: Ciqual supplies reference nutrition compositions rather than verified ingredient labels. The editor explains this limitation.

Reference foods use optimized WebP images from the food R2 bucket. Credits identify licensed source photographs and original generated illustrations. Custom entries can include a private thumbnail. Category icons remain the fallback when an image fails to load.

Meal cache invalidation now runs independent operations together and deletes the collected server keys in one call. The client invalidates its related caches concurrently; background refreshes do not hold the form open. Catalogue browsing no longer downloads or serializes the entire shared library. No frame-rate guarantee is inferred from automated tests; check scrolling and keyboard interaction on a target phone before release.

Checks: `scripts/test_food_catalog.ts` exercises HTTP pagination, escaped search, nutritional normalization, private-food ownership and custom saves. Flutter nutrition tests cover pagination reset, stale-response protection, opening custom entry during a pending request, grams conversion, successful navigation, large text and keyboard layout.
