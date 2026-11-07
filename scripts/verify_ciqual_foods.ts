import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { getAllNutritionItems, getUserNutritionItems, logUserMeal } from '../modules/nutrition/nutrition_service';

async function main() {
  const catalogue = await getAllNutritionItems();
  const imported = catalogue.filter(food => food.sourceName === 'ANSES_CIQUAL' && food.sourceVersion === '2025');
  assert.equal(imported.length, 2239);
  assert(imported.every(food => food.userId === null && food.imageUrl === null && !('sourceDetails' in food)));
  const rice = imported.find(food => food.sourceFoodCode === '9103');
  assert(rice);
  const search = await getAllNutritionItems({ search: 'wholegrain', category: 'CARB_SOURCE' });
  assert(search.some(food => food.id === rice.id));
  assert.equal(rice.servingSize, 100);
  assert.equal(rice.servingUnit, 'g');
  assert.equal(rice.sodiumPerServing, 14); // mg per 100 g, not salt in grams

  const owner = await prisma.user.create({ data: { email: `food-check-${randomUUID()}@example.invalid`, password: 'isolated-test' } });
  try {
    const date = new Date().toISOString().slice(0, 10);
    const parts = { day: date.slice(8), month: date.slice(5, 7), year: date.slice(0, 4) };
    const logged = await logUserMeal(owner.id, { ...parts, nutritionId: rice.id, mealType: 'LUNCH', servings: 1.5 });
    assert.equal(logged.calories, 280.5);
    assert.equal(logged.protein, 5.8);
    assert.equal(logged.carbs, 56.4);
    assert.equal(logged.fat, 2.7);
    const daily = await getUserNutritionItems(owner.id, parts.day, parts.month, parts.year);
    assert.equal(daily.dailySummary.totalCalories, 280.5);
    assert.equal(daily.dailySummary.totalProtein, 5.8);
    assert.equal(daily.logs.length, 1);
    console.log(JSON.stringify({ catalogueFoods: imported.length, searchMatches: search.length,
      portionGrams: 150, loggedCalories: logged.calories, loggedProtein: logged.protein,
      cataloguePayloadBytes: Buffer.byteLength(JSON.stringify(catalogue)), passed: true }, null, 2));
  } finally {
    const keys = await redis.keys(`*${owner.id}*`).catch(() => []);
    if (keys.length) await redis.del(...keys).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
