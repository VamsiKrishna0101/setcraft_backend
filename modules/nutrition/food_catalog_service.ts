import fs from "node:fs";
import path from "node:path";
import { Prisma, Nutrition } from "@prisma/client";

import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { progressRevision } from "../progress/progress_cache";
import { contentLocale } from "../../utils/app_locale";
import { FoodCatalogQuery } from "./nutrition_types";
import {
  filterAndRankFoods,
  getStemVariants,
  tokenMatchesText,
  CANONICAL_FOOD_ALIASES,
} from "./food_search";

let names: Record<string, Record<string, string>> = {};
let namesUpdatedAt = 0;

function foodNames() {
  try {
    const file = path.resolve(process.cwd(), "data/food_names.json");
    const updatedAt = fs.statSync(file).mtimeMs;
    if (updatedAt !== namesUpdatedAt) {
      names = JSON.parse(fs.readFileSync(file, "utf8"));
      namesUpdatedAt = updatedAt;
    }
  } catch {
    // Existing catalogue names remain usable if optional translations are missing.
  }
  return names;
}

export function localizedFood<T extends { id: string; name: string }>(
  food: T,
  locale: string,
) {
  const translations = foodNames()[food.id];
  const { sourceDetails, photoData, photoMime, ...visible } = food as T & {
    sourceDetails?: { portions?: unknown[]; defaultPortionUnit?: string };
    photoData?: unknown;
    photoMime?: unknown;
  };
  return {
    ...visible,
    portions: sourceDetails?.portions ?? [],
    defaultPortionUnit: sourceDetails?.defaultPortionUnit ?? "g",
    imageAttribution:
      (sourceDetails as any)?.image ?? (food as any).imageAttribution ?? null,
    canonicalName: food.name,
    name:
      translations?.en === food.name
        ? (translations[contentLocale(locale)] ?? food.name)
        : food.name,
  };
}

// Search translated and original names. All SQL values use bound parameters.
export async function getFoodCatalogPage(
  userId: string,
  query: FoodCatalogQuery,
  locale = "en",
) {
  const language = contentLocale(locale);
  const translations = foodNames();
  const personal = query.source !== "LIBRARY";
  const revision = personal ? await progressRevision(userId) : "";
  const key = personal
    ? `usernutrition:${userId}:foods:generic-300-v2:${revision}:${language}:${JSON.stringify(query)}`
    : `nutrition_items:generic-300-v2:page:${namesUpdatedAt}:${language}:${JSON.stringify(query)}`;

  try {
    const cached = await redis.get<any>(key);
    if (cached) return cached;
  } catch {
    /* Cache availability must not block food browsing. */
  }

  const conditions: Prisma.Sql[] = [Prisma.sql`"isArchived" = false`];
  if (query.source === "LIBRARY") conditions.push(Prisma.sql`"userId" IS NULL`);
  if (query.source === "MY_FOODS" || query.source === "MY_MEALS") {
    conditions.push(Prisma.sql`"userId" = ${userId}`);
    conditions.push(
      query.source === "MY_MEALS"
        ? Prisma.sql`category = 'MEAL'::"NutritionCategory"`
        : Prisma.sql`category <> 'MEAL'::"NutritionCategory"`,
    );
  }
  if (query.source === "RECENT") {
    conditions.push(Prisma.sql`("userId" IS NULL OR "userId" = ${userId})`);
    conditions.push(Prisma.sql`name NOT LIKE 'Today preview · %'`);
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "UserMealLog" log
      WHERE log."nutritionId" = "Nutrition".id AND log."userId" = ${userId} AND log.status = 'LOGGED')`);
  }

  if (query.category)
    conditions.push(
      Prisma.sql`category = ${query.category}::"NutritionCategory"`,
    );

  const searchTrimmed = query.search.trim().toLowerCase();
  const isSearching = searchTrimmed.length > 0;

  if (isSearching) {
    const aliasIds = CANONICAL_FOOD_ALIASES[searchTrimmed] || [];
    const searchTerms = searchTrimmed.split(/\s+/).filter(Boolean);
    const translatedIds: string[] = [];

    if (query.source === "LIBRARY") {
      for (const [id, values] of Object.entries(translations)) {
        const transText = values[language] || values.en || "";
        if (searchTerms.every((term) => tokenMatchesText(transText, term))) {
          translatedIds.push(id);
        }
      }
    }

    const candidateIds = Array.from(new Set([...aliasIds, ...translatedIds]));

    const termConditions: Prisma.Sql[] = [];
    for (const term of searchTerms) {
      const variants = getStemVariants(term);
      const variantSqls: Prisma.Sql[] = [];
      for (const v of variants) {
        const escaped = v.replace(/[\\%_]/g, "\\$&");
        variantSqls.push(Prisma.sql`name ILIKE ${`%${escaped}%`}`);
        variantSqls.push(Prisma.sql`brand ILIKE ${`%${escaped}%`}`);
      }
      if (candidateIds.length > 0) {
        variantSqls.push(Prisma.sql`id IN (${Prisma.join(candidateIds)})`);
      }
      termConditions.push(Prisma.sql`(${Prisma.join(variantSqls, " OR ")})`);
    }

    if (termConditions.length > 0) {
      if (aliasIds.length > 0) {
        conditions.push(
          Prisma.sql`(${Prisma.join(termConditions, " AND ")} OR id IN (${Prisma.join(aliasIds)}))`,
        );
      } else {
        conditions.push(Prisma.sql`(${Prisma.join(termConditions, " AND ")})`);
      }
    }
  }

  if (query.focus !== "ALL") {
    conditions.push(Prisma.sql`"servingUnit" = 'g' AND "servingSize" > 0`);
    if (query.focus === "PROTEIN")
      conditions.push(
        Prisma.sql`"proteinPerServing" * 100 / NULLIF("servingSize", 0) >= 15`,
      );
    if (query.focus === "FIBRE")
      conditions.push(
        Prisma.sql`"fiberPerServing" * 100 / NULLIF("servingSize", 0) >= 3`,
      );
    if (query.focus === "LIGHTER")
      conditions.push(
        Prisma.sql`"caloriesPerServing" * 100 / NULLIF("servingSize", 0) <= 100`,
      );
  }

  const where = Prisma.join(conditions, " AND ");
  const protein = Prisma.sql`CASE WHEN "servingUnit" = 'g' THEN "proteinPerServing" * 100 / NULLIF("servingSize", 0) END`;
  const calories = Prisma.sql`CASE WHEN "servingUnit" = 'g' THEN "caloriesPerServing" * 100 / NULLIF("servingSize", 0) END`;

  if (isSearching) {
    const result = await prisma.$transaction(
      async (tx) => {
        const candidateFoods = await tx.$queryRaw<
          Array<Omit<Nutrition, "sourceDetails">>
        >(Prisma.sql`
        SELECT id, name, brand, category, "imageUrl", barcode, "servingSize", "servingUnit",
          "caloriesPerServing", "proteinPerServing", "carbsPerServing", "fatPerServing",
          "fiberPerServing", "sugarPerServing", "sodiumPerServing", "mealTypes", "isVerified",
          "userId", "sourceName", "sourceFoodCode", "sourceVersion", "sourceUrl", "sourceDetails", "createdAt", "updatedAt"
        FROM "Nutrition" WHERE ${where}`);

        const ranked = filterAndRankFoods(
          candidateFoods as any[],
          query.search,
          {
            category: query.category,
            focus: query.focus,
            language,
            foodTranslations: translations,
          },
        );

        if (query.sort === "PROTEIN") {
          ranked.items.sort((a, b) => {
            const pa =
              a.servingSize && a.servingSize > 0
                ? ((a.proteinPerServing ?? 0) * 100) / a.servingSize
                : -1;
            const pb =
              b.servingSize && b.servingSize > 0
                ? ((b.proteinPerServing ?? 0) * 100) / b.servingSize
                : -1;
            return pb - pa;
          });
        } else if (query.sort === "CALORIES") {
          ranked.items.sort((a, b) => {
            const ca =
              a.servingSize && a.servingSize > 0
                ? ((a.caloriesPerServing ?? 0) * 100) / a.servingSize
                : 9999;
            const cb =
              b.servingSize && b.servingSize > 0
                ? ((b.caloriesPerServing ?? 0) * 100) / b.servingSize
                : 9999;
            return ca - cb;
          });
        }

        const total = ranked.total;
        const totalPages = Math.ceil(total / query.pageSize);
        const page = Math.min(query.page, Math.max(1, totalPages));
        const offset = (page - 1) * query.pageSize;
        const pageFoods = ranked.items.slice(offset, offset + query.pageSize);

        return {
          foods: pageFoods.map((food) => localizedFood(food as any, language)),
          page,
          pageSize: query.pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    try {
      await redis.set(key, result, { ex: personal ? 60 : 3600 });
    } catch {}
    return result;
  }

  const order =
    query.source === "RECENT" && query.sort === "NAME"
      ? Prisma.sql`(SELECT MAX(log."createdAt") FROM "UserMealLog" log
        WHERE log."nutritionId" = "Nutrition".id AND log."userId" = ${userId} AND log.status = 'LOGGED') DESC, name ASC, id ASC`
      : query.sort === "PROTEIN"
        ? Prisma.sql`${protein} DESC NULLS LAST, name ASC, id ASC`
        : query.sort === "CALORIES"
          ? Prisma.sql`${calories} ASC NULLS LAST, name ASC, id ASC`
          : Prisma.sql`name ASC, id ASC`;

  const result = await prisma.$transaction(
    async (tx) => {
      const counts = await tx.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) AS total FROM "Nutrition" WHERE ${where}`,
      );
      const total = Number(counts[0]!.total);
      const totalPages = Math.ceil(total / query.pageSize);
      const page = Math.min(query.page, Math.max(1, totalPages));

      const foods = await tx.$queryRaw<
        Array<Omit<Nutrition, "sourceDetails">>
      >(Prisma.sql`
      SELECT id, name, brand, category, "imageUrl", barcode, "servingSize", "servingUnit",
        "caloriesPerServing", "proteinPerServing", "carbsPerServing", "fatPerServing",
        "fiberPerServing", "sugarPerServing", "sodiumPerServing", "mealTypes", "isVerified",
        "userId", "sourceName", "sourceFoodCode", "sourceVersion", "sourceUrl", "sourceDetails", "createdAt", "updatedAt"
      FROM "Nutrition" WHERE ${where} ORDER BY ${order}
      LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`);

      return {
        foods: foods.map((food) => localizedFood(food, language)),
        page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  try {
    await redis.set(key, result, { ex: personal ? 60 : 3600 });
  } catch {}
  return result;
}
