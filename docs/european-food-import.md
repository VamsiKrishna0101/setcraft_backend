# European food catalogue

The original broad import contained 2,239 adult-food entries from **Anses. 2025. Ciqual French food composition table**. These are reference compositions, not brand-specific package labels or a complete catalogue of every food sold in Europe. Users can still add private custom foods from labels and recipes.

Source: https://doi.org/10.5281/zenodo.17550133

The English workbook is retained at `data/food_sources/ciqual-2025.xlsx`; its publisher MD5 is `a953e8c473d8cee24a32f89a48fbd54d`. Reuse is under the Open Licence with source/version attribution. The source and attribution are stored on each imported record and credited on the food portion screen.

The active app library now uses [300 generic foods](generic-food-catalog.md), retaining the original [181 everyday food identities](everyday-foods.md). This document describes the original reference import and its retained source files. Do not rerun `--apply` to restore the broad catalogue unless explicitly intended.

## Nutrition and quantities

All imported values use **100 g of edible portion**, including beverages. Calories are kcal; protein, carbohydrate, fat, fibre and sugars are grams; sodium is milligrams. Raw/cooked preparations retain their actual source names. The logging UI accepts grams for these entries: 150 g becomes 1.5 backend servings of a 100 g food.

The source contains 3,484 entries. This import skips baby foods and any entry with a missing, trace-only or less-than-bound value in the seven required nutrient fields. It never replaces those values with zero. Actual numeric zero remains valid. Omitted entries remain available in the original source for a future model that supports nutrient uncertainty.

## Images

Ciqual does not supply food photos. The original broad import had null `imageUrl` values. The current 300-food catalogue supplies separately reviewed representative images and credits, described in [generic-food-catalog.md](generic-food-catalog.md).

## Repeatable import

1. Apply migrations and generate the Prisma client.
2. Use the bundled Python runtime with openpyxl to run `scripts/extract_ciqual_foods.py`.
3. Run `node --import tsx scripts/import_ciqual_foods.ts` for a dry run.
4. Run the same command with `--apply` to add validated foods.
5. Run `node --import tsx scripts/verify_ciqual_foods.ts` to check catalogue retrieval, search and quantity-based logging using an isolated temporary account.

The importer uses stable IDs and a unique source/code/version key. Repeating it adds no duplicate entries. It never updates or deletes existing foods or logs, verifies their contents inside the import transaction, and clears only shared catalogue caches. Its plan and result are recorded under `data/food_sources/`.
