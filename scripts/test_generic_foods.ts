import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadGenericCatalog,
  validateGenericFoods,
  FOOD_COUNT,
  FOOD_NUTRIENTS,
} from "../utils/generic_food_catalog";

const root = path.resolve(__dirname, "..");
const catalog = loadGenericCatalog(root, false);
assert.equal(catalog.foods.length, FOOD_COUNT);
const old = JSON.parse(
  fs.readFileSync(path.join(root, "data/everyday_foods.json"), "utf8"),
);
for (const expected of old.foods) {
  const food = catalog.foods.find((f: any) => f.id === expected.id);
  assert(food, `${expected.name}: existing source identity was lost`);
  for (const nutrient of FOOD_NUTRIENTS)
    assert.equal(
      food[nutrient],
      expected[nutrient],
      `${expected.name}: reference nutrition changed`,
    );
  assert.deepEqual(
    food.sourceDetails.portions,
    expected.sourceDetails.portions,
    `${expected.name}: portion conversion changed`,
  );
}
const whey = catalog.foods.find((f: any) => f.name === "Whey protein");
assert(
  whey &&
    whey.sourceFoodCode === "173180" &&
    whey.sourceName === "USDA_SR_LEGACY",
);
assert.equal(whey.proteinPerServing, 78.1);
assert.equal(whey.servingSize, 100);
assert.equal(whey.sourceDetails.portions[0].gramsPerUnit, 30);
assert.equal(whey.sourceDetails.defaultPortionUnit, "portion");
assert.match(whey.sourceDetails.referenceNote, /Actual products/);
for (const mutation of [
  (f: any[]) => f.pop(),
  (f: any[]) => {
    f[1].id = f[0].id;
  },
  (f: any[]) => {
    f[1].name = f[0].name;
  },
  (f: any[]) => {
    f[0].brand = "A brand";
  },
  (f: any[]) => {
    f[0].fiberPerServing = null;
  },
  (f: any[]) => {
    f[0].proteinPerServing = -1;
  },
  (f: any[]) => {
    f[0].servingSize = 1;
  },
]) {
  const changed = structuredClone(catalog.foods);
  mutation(changed);
  assert.throws(() => validateGenericFoods(changed));
}
if (process.argv.includes("--photos")) {
  const ready = loadGenericCatalog(root);
  assert(
    ready.foods.every(
      (f: any) => f.imageUrl && f.sourceDetails.image.creditUrl,
    ),
  );
  assert.equal(
    new Set(ready.foods.map((f: any) => f.imageUrl)).size,
    FOOD_COUNT,
  );
}
console.log(
  `PASS: ${FOOD_COUNT} generic foods, reference nutrition, stable history identities, portions, and invalid-data rejection`,
);
