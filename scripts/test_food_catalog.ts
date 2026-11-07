import fs from "node:fs";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import redis from "../config/redis";
import routes from "../modules/nutrition/nutrition_routes";

async function main() {
  const owners = await Promise.all(
    [1, 2].map(() =>
      prisma.user.create({
        data: {
          email: `catalog-${randomUUID()}@example.invalid`,
          password: "isolated-test",
          trialStartedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 14 * 86400000),
        },
      }),
    ),
  );
  const app = express();
  app.use(express.json());
  app.use("/nutrition", routes);
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: error.message });
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/nutrition`;
  const call = (query: string, owner = owners[0]!.id, language = "en") =>
    fetch(`${base}/catalog${query}`, {
      headers: {
        "accept-language": language,
        authorization: `Bearer ${jwt.sign({ userId: owner }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" })}`,
      },
    });
  const page = async (
    query: string,
    owner?: string,
    language = "en",
  ): Promise<any> => {
    const response = await call(query, owner, language);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as any).data;
  };
  try {
    assert.equal((await fetch(`${base}/catalog`)).status, 401);
    for (const query of [
      "?page=0",
      "?pageSize=200",
      "?focus=VEGAN",
      "?category=BAD",
      "?sort=BAD",
    ])
      assert.equal((await call(query)).status, 400);
    const first = await page("?page=1"),
      second = await page("?page=2");
    assert.equal(first.foods.length, 24);
    assert.equal(second.foods.length, 24);
    assert.equal(first.total, 300);
    assert.equal(first.total, second.total);
    assert(
      !first.foods.some((a: any) =>
        second.foods.some((b: any) => a.id === b.id),
      ),
    );
    assert(
      first.foods.every(
        (food: any) =>
          food.userId === null &&
          !("sourceDetails" in food) &&
          food.brand === null &&
          food.barcode === null &&
          food.imageUrl?.startsWith("https://") &&
          food.imageAttribution?.creditUrl?.startsWith("https://") &&
          food.imageAttribution?.representative === true,
      ),
    );
    const whey = await page("?search=whey%20protein");
    assert.equal(whey.total, 1);
    assert.equal(whey.foods[0].name, "Whey protein");
    assert.equal(whey.foods[0].proteinPerServing, 78.1);
    assert.equal(whey.foods[0].defaultPortionUnit, "portion");
    assert.equal(whey.foods[0].portions[0].gramsPerUnit, 30);
    const translations = JSON.parse(
      fs.readFileSync("data/food_names.json", "utf8"),
    );
    const selection = JSON.parse(
      fs.readFileSync("data/generic_foods.json", "utf8"),
    ).foods as Array<{ id: string; name: string }>;
    const [foodId, labels] = Object.entries(translations).find(
      ([id, value]: any) =>
        selection.some((f) => f.id === id && f.name === value.en) &&
        value.de &&
        value.de !== value.en,
    )! as [string, any];
    const german = await page(
      "?search=" + encodeURIComponent(labels.de),
      undefined,
      "de-CH",
    );
    const germanFood = german.foods.find((food: any) => food.id === foodId);
    assert(germanFood, "Translated names must be searchable.");
    assert.equal(germanFood.name, labels.de);
    assert.equal(germanFood.canonicalName, labels.en);
    const canonical = await prisma.nutrition.findUniqueOrThrow({
      where: { id: foodId },
    });
    assert.equal(germanFood.proteinPerServing, canonical.proteinPerServing);
    assert.equal(germanFood.caloriesPerServing, canonical.caloriesPerServing);
    const last = await page("?page=100000");
    assert.equal(last.page, last.totalPages);
    assert.equal(last.hasNextPage, false);
    const search = await page(
      "?search=chicken%20breast&category=PROTEIN_SOURCE",
    );
    assert(search.total > 0);
    assert(
      search.foods.every(
        (food: any) =>
          /chicken/i.test(food.name) &&
          /breast/i.test(food.name) &&
          food.category === "PROTEIN_SOURCE",
      ),
    );
    const percent = await page("?search=%25");
    assert(
      percent.foods.every((food: any) =>
        `${food.name} ${food.brand ?? ""}`.includes("%"),
      ),
    ); // wildcard is treated literally
    assert.equal((await page("?search=%27%20OR%20TRUE%20--")).total, 0);
    const protein = await page("?focus=PROTEIN&sort=PROTEIN");
    assert(
      protein.foods.every(
        (f: any) => (f.proteinPerServing * 100) / f.servingSize >= 15,
      ),
    );
    for (let i = 1; i < protein.foods.length; i++)
      assert(
        protein.foods[i - 1].proteinPerServing /
          protein.foods[i - 1].servingSize >=
          protein.foods[i].proteinPerServing / protein.foods[i].servingSize,
      );
    const lighter = await page("?focus=LIGHTER&sort=CALORIES");
    assert(
      lighter.foods.every(
        (f: any) => (f.caloriesPerServing * 100) / f.servingSize <= 100,
      ),
    );
    const fibre = await page("?focus=FIBRE");
    assert(
      fibre.foods.every(
        (f: any) => (f.fiberPerServing * 100) / f.servingSize >= 3,
      ),
    );
    await prisma.nutrition.createMany({
      data: owners.map((owner) => ({
        userId: owner.id,
        name: "Private recipe",
        category: "PROTEIN_SOURCE",
        servingSize: 500,
        servingUnit: "g",
        caloriesPerServing: 400,
        proteinPerServing: 20,
        carbsPerServing: 50,
        fatPerServing: 5,
        mealTypes: ["LUNCH"],
      })),
    });
    const mine = await page(`?source=MY_FOODS&userId=${owners[1]!.id}`);
    const frenchPrivate = await page("?source=MY_FOODS", undefined, "fr");
    assert.equal(frenchPrivate.foods[0].name, "Private recipe");
    assert.equal(mine.total, 1);
    assert.equal(mine.foods[0].userId, owners[0]!.id);
    assert.equal((await page("?source=MY_FOODS&focus=PROTEIN")).total, 0); // 20 g in 500 g is only 4 g per 100 g
    assert.equal((await page("?source=MY_FOODS&focus=LIGHTER")).total, 1);
    const now = new Date(),
      date = {
        day: String(now.getDate()),
        month: String(now.getMonth() + 1),
        year: String(now.getFullYear()),
      };
    const started = Date.now();
    const logged = await fetch(`${base}/me/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${jwt.sign({ userId: owners[0]!.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" })}`,
      },
      body: JSON.stringify({
        ...date,
        mealType: "LUNCH",
        servings: 1.5,
        customFood: {
          name: "Quick custom recipe",
          servingSize: 100,
          servingUnit: "g",
          calories: 120,
          protein: 10,
          carbs: 14,
          fat: 3,
        },
      }),
    });
    assert.equal(logged.status, 201, await logged.clone().text());
    const body = (await logged.json()) as any;
    assert.equal(body.data.calories, 180);
    assert.equal(body.data.protein, 15);
    const customSaveMs = Date.now() - started;
    const token = jwt.sign(
      { userId: owners[0]!.id },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "10m" },
    );
    const headers = {
      "Content-Type": "application/json",
      authorization: "Bearer " + token,
    };
    const photo =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4QAAAABJRU5ErkJggg==";
    const savedMeal = await fetch(base + "/me/log", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...date,
        mealType: "BREAKFAST",
        servings: 2,
        customFood: {
          name: "My breakfast bowl",
          category: "MEAL",
          servingSize: 1,
          servingUnit: "portion",
          calories: 300,
          protein: 20,
          carbs: 40,
          fat: 7,
          photo: { mimeType: "image/png", base64: photo },
        },
      }),
    });
    assert.equal(savedMeal.status, 201, await savedMeal.clone().text());
    const meal = ((await savedMeal.json()) as any).data;
    assert.equal(meal.calories, 600);
    const meals = await page("?source=MY_MEALS");
    assert.equal(meals.total, 1);
    assert.equal(meals.foods[0].id, meal.nutrition.id);
    assert.equal((await page("?source=MY_MEALS", owners[1]!.id)).total, 0);
    assert(!JSON.stringify(meals).includes("photoData"));
    assert(!JSON.stringify(meals).includes(photo));
    const photoResponse = await fetch(
      base + "/me/custom-foods/" + meal.nutrition.id + "/photo",
      { headers },
    );
    assert.equal(photoResponse.status, 200);
    assert.equal(
      photoResponse.headers.get("cache-control"),
      "private, no-store",
    );
    assert(
      Buffer.from(await photoResponse.arrayBuffer()).equals(
        Buffer.from(photo, "base64"),
      ),
    );
    assert.equal(
      (await fetch(base + "/me/custom-foods/" + meal.nutrition.id + "/photo"))
        .status,
      401,
    );
    const otherHeaders = {
      authorization:
        "Bearer " +
        jwt.sign({ userId: owners[1]!.id }, process.env.JWT_ACCESS_SECRET!, {
          expiresIn: "5m",
        }),
    };
    assert.equal(
      (
        await fetch(base + "/me/custom-foods/" + meal.nutrition.id + "/photo", {
          headers: otherHeaders,
        })
      ).status,
      404,
    );
    const recent = await page("?source=RECENT");
    assert(recent.foods.some((f: any) => f.id === meal.nutrition.id));
    assert.equal((await page("?source=RECENT", owners[1]!.id)).total, 0);
    assert.equal(
      recent.foods.filter((f: any) => f.id === meal.nutrition.id).length,
      1,
    );
    const archived = await fetch(
      base + "/me/custom-foods/" + meal.nutrition.id,
      { method: "DELETE", headers },
    );
    assert.equal(archived.status, 200);
    assert.equal((await page("?source=MY_MEALS")).total, 0);
    assert(
      !(await page("?source=RECENT")).foods.some(
        (f: any) => f.id === meal.nutrition.id,
      ),
    );
    assert.equal(
      (await prisma.userMealLog.findUniqueOrThrow({ where: { id: meal.id } }))
        .calories,
      600,
    );
    assert.equal(
      (
        await fetch(base + "/me/custom-foods/" + meal.nutrition.id + "/photo", {
          headers,
        })
      ).status,
      404,
    );
    const unavailable = await fetch(base + "/me/log", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...date,
        mealType: "BREAKFAST",
        servings: 1,
        nutritionId: meal.nutrition.id,
      }),
    });
    assert.equal(unavailable.status, 400);

    const eggs = await page("?search=boiled%20egg");
    assert.equal(eggs.foods.length, 1);
    assert.equal(eggs.foods[0].portions[0].gramsPerUnit, 50);
    assert.equal(eggs.foods[0].defaultPortionUnit, "egg");
    const milk = (await page("?search=whole%20milk")).foods.find((f: any) =>
      f.name.startsWith("Whole milk"),
    );
    assert.equal(milk.defaultPortionUnit, "ml");
    assert(Math.abs(milk.portions[0].gramsPerUnit - 1.0313276924) < 0.000001);

    console.log(
      JSON.stringify(
        {
          passed: true,
          totalFoods: first.total,
          pageBytes: Buffer.byteLength(JSON.stringify(first)),
          customSaveMs,
          checks:
            "pagination, stable ordering, normalized nutrition filters, escaped search, personal food ownership and custom save",
        },
        null,
        2,
      ),
    );
  } finally {
    server.close();
    for (const owner of owners) {
      const keys = await redis.keys(`*${owner.id}*`).catch(() => []);
      if (keys.length) await redis.del(...keys).catch(() => undefined);
      await prisma.user.delete({ where: { id: owner.id } });
    }
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
