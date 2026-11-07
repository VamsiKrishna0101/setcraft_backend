import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MealType, Prisma } from "@prisma/client";
import prisma from "../config/prisma";
import redis from "../config/redis";
import {
  loadGenericCatalog,
  FOOD_CATALOG_VERSION,
  FOOD_COUNT,
  FOOD_NUTRIENTS,
} from "../utils/generic_food_catalog";

const root = path.resolve(__dirname, "..");
const input = path.join(root, "data/generic_foods.json");
const nutrients = FOOD_NUTRIENTS;

async function main() {
  const source = await fs.readFile(input, "utf8");
  const catalog = loadGenericCatalog(root) as {
    version: string;
    foods: Prisma.NutritionCreateManyInput[];
  };
  assert.equal(catalog.version, FOOD_CATALOG_VERSION);
  assert.equal(catalog.foods.length, FOOD_COUNT);
  assert.equal(
    new Set(catalog.foods.map((food) => food.id)).size,
    catalog.foods.length,
  );
  assert.equal(
    new Set(catalog.foods.map((food) => food.name)).size,
    catalog.foods.length,
  );

  for (const food of catalog.foods) {
    assert.equal(food.servingSize, 100);
    assert.equal(food.servingUnit, "g");
    assert.ok(food.sourceUrl && food.sourceFoodCode && food.name.length <= 100);
    for (const key of nutrients)
      assert.ok(
        Number.isFinite(food[key]) && Number(food[key]) >= 0,
        `${food.name}: ${key}`,
      );
    assert.ok(Number(food.caloriesPerServing) <= 1000);
  }

  if (process.argv.includes("--check")) {
    const actual = await prisma.nutrition.findMany({
      where: { userId: null, isArchived: false },
    });
    assert.equal(actual.length, catalog.foods.length);
    for (const expected of catalog.foods) {
      const food = actual.find((row) => row.id === expected.id);
      assert.ok(food, expected.name + ": missing food");
      assert.equal(food.name, expected.name);
      assert.equal(food.servingSize, expected.servingSize);
      assert.equal(food.servingUnit, expected.servingUnit);
      assert.equal(food.imageUrl, expected.imageUrl);
      assert.equal(food.brand, null);
      assert.equal(food.barcode, null);
      assert.deepEqual(food.sourceDetails, expected.sourceDetails);
      for (const key of nutrients)
        assert.equal(food[key], expected[key], expected.name + ": " + key);
    }
    console.log({
      verifiedFoods: actual.length,
      customFoods: await prisma.nutrition.count({
        where: { userId: { not: null } },
      }),
      mealLogs: await prisma.userMealLog.count(),
    });
    return;
  }

  if (!process.argv.includes("--apply")) {
    const [shared, custom, logs] = await Promise.all([
      prisma.nutrition.count({ where: { userId: null } }),
      prisma.nutrition.count({ where: { userId: { not: null } } }),
      prisma.userMealLog.count(),
    ]);
    console.log({
      mode: "dry run",
      currentSharedFoods: shared,
      customFoodsToKeep: custom,
      mealLogsToKeep: logs,
      freshCatalogue: catalog.foods.length,
    });
    return;
  }

  // The app only switches after every reviewed image is publicly available.
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(root, "build/food-catalog/images-uploaded.json"),
      "utf8",
    ),
  );
  assert.equal(
    receipt.catalogSha256,
    createHash("sha256").update(source).digest("hex"),
    "Image verification belongs to another catalogue",
  );
  assert.equal(receipt.verified.length, FOOD_COUNT);
  for (const food of catalog.foods) {
    const image = receipt.verified.find(
      (entry: any) => entry.foodId === food.id,
    );
    assert(
      image &&
        image.url === food.imageUrl &&
        image.sha256 === (food.sourceDetails as any).image.sha256,
      `${food.name}: image has not passed public delivery verification`,
    );
  }

  const folder = path.join(root, "build/food-catalog");
  await fs.mkdir(folder, { recursive: true });
  const backup = path.join(folder, `before-${Date.now()}.json`);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(718302415)`;
      // Block concurrent catalogue/log writes while checking dependencies. Readers
      // continue seeing the previous catalogue until this transaction commits.
      await tx.$executeRawUnsafe(
        'LOCK TABLE "Nutrition", "UserMealLog", "UserMealPlanItem" IN SHARE ROW EXCLUSIVE MODE',
      );

      const oldFoods = await tx.nutrition.findMany({ where: { userId: null } });
      const oldCustom = await tx.nutrition.findMany({
        where: { userId: { not: null } },
        orderBy: { id: "asc" },
      });
      const oldLogs = await tx.userMealLog.findMany({ orderBy: { id: "asc" } });
      const oldPlanItems = await tx.userMealPlanItem.findMany({
        orderBy: { id: "asc" },
      });

      // Backup must succeed before any deletion. Only shared foods are backed up;
      // private recipes/photos and member logs are not copied into a local file.
      await fs.writeFile(
        backup,
        JSON.stringify(
          { savedAt: new Date().toISOString(), foods: oldFoods },
          null,
          2,
        ),
      );

      const keepIds = catalog.foods.map((food) => food.id!);
      const removed = await tx.nutrition.deleteMany({
        where: {
          userId: null,
          id: { notIn: keepIds },
          mealLogs: { none: {} },
          mealPlanItems: { none: {} },
        },
      });
      const archived = await tx.nutrition.updateMany({
        where: {
          userId: null,
          id: { notIn: keepIds },
        },
        data: { isArchived: true },
      });

      for (const food of catalog.foods) {
        const existing = oldFoods.find((row) => row.id === food.id);
        if (existing) {
          // A reused Ciqual identity retains its exact quantities and nutrients.
          for (const key of nutrients)
            assert.equal(
              existing[key],
              food[key],
              `${food.name}: source mismatch`,
            );
          assert.equal(existing.servingSize, food.servingSize);
          assert.equal(existing.servingUnit, food.servingUnit);
          await tx.nutrition.update({
            where: { id: food.id },
            data: {
              name: food.name,
              category: food.category,
              sourceDetails: food.sourceDetails,
              imageUrl: food.imageUrl,
              brand: null,
              barcode: null,
              isArchived: false,
              isVerified: true,
            },
          });
        } else {
          await tx.nutrition.create({
            data: {
              ...food,
              mealTypes: Object.values(MealType),
              isArchived: false,
              isVerified: true,
              userId: null,
              imageUrl: food.imageUrl,
            },
          });
        }
      }

      assert.equal(
        await tx.nutrition.count({
          where: { userId: null, isArchived: false },
        }),
        catalog.foods.length,
      );
      assert.deepEqual(
        await tx.userMealLog.findMany({ orderBy: { id: "asc" } }),
        oldLogs,
        "Meal history changed",
      );
      assert.deepEqual(
        await tx.userMealPlanItem.findMany({ orderBy: { id: "asc" } }),
        oldPlanItems,
        "Saved meal plans changed",
      );
      assert.deepEqual(
        await tx.nutrition.findMany({
          where: { userId: { not: null } },
          orderBy: { id: "asc" },
        }),
        oldCustom,
        "Private foods changed",
      );

      return {
        activeFoods: catalog.foods.length,
        deletedUnusedFoods: removed.count,
        archivedHistoryFoods: archived.count,
        preservedCustomFoods: oldCustom.length,
        preservedMealLogs: oldLogs.length,
        preservedPlanItems: oldPlanItems.length,
      };
    },
    {
      timeout: 120000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  const cacheKeys = await redis.keys("nutrition_items:*");
  const itemKeys = await redis.keys("nutrition_item:*");
  if (cacheKeys.length || itemKeys.length)
    await redis.del(...cacheKeys, ...itemKeys);

  const resultReceipt = {
    ...result,
    catalogSha256: createHash("sha256").update(source).digest("hex"),
    backup,
  };
  await fs.writeFile(
    path.join(folder, "latest-result.json"),
    JSON.stringify(resultReceipt, null, 2),
  );
  console.log(resultReceipt);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
