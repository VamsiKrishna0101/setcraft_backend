import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";

export const FOOD_CATALOG_VERSION = "generic-300-v1";
export const FOOD_BUCKET = "fitai-food-images";
export const FOOD_PUBLIC_ORIGIN =
  "https://pub-134bda0dd83b4c4793daf0b75e890947.r2.dev";
export const FOOD_COUNT = 300;
export const FOOD_NUTRIENTS = [
  "caloriesPerServing",
  "proteinPerServing",
  "carbsPerServing",
  "fatPerServing",
  "fiberPerServing",
  "sugarPerServing",
  "sodiumPerServing",
] as const;
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export type FoodPhoto = {
  name: string;
  reviewed: boolean;
  reviewedSha256?: string;
  title: string;
  sourceUrl: string;
  originalUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  outputFile: string;
  sha256: string;
  sourceSha256: string;
  localSource: string;
  generated?: boolean;
  generationTool?: string;
  promptFile?: string;
  provider?: string;
};

export function validateGenericFoods(foods: Prisma.NutritionCreateManyInput[]) {
  assert.equal(
    foods.length,
    FOOD_COUNT,
    "The catalogue must contain exactly 300 foods",
  );
  for (const key of ["id", "name"] as const)
    assert.equal(
      new Set(foods.map((f) => String(f[key]).toLowerCase())).size,
      FOOD_COUNT,
      `Duplicate ${key}`,
    );
  assert.equal(
    new Set(
      foods.map(
        (f) => `${f.sourceName}:${f.sourceFoodCode}:${f.sourceVersion}`,
      ),
    ).size,
    FOOD_COUNT,
    "Duplicate nutrition source",
  );
  for (const food of foods) {
    assert(
      food.id &&
        food.name &&
        food.name.length <= 100 &&
        food.sourceUrl &&
        food.sourceFoodCode &&
        food.sourceVersion,
      "Missing food identity/provenance",
    );
    assert(
      !food.brand && !food.barcode,
      `${food.name}: branded products are outside this catalogue`,
    );
    assert.equal(
      food.servingSize,
      100,
      `${food.name}: invalid nutrition basis`,
    );
    assert.equal(
      food.servingUnit,
      "g",
      `${food.name}: unsupported quantity conversion`,
    );
    for (const nutrient of FOOD_NUTRIENTS) {
      const value = food[nutrient];
      assert(
        typeof value === "number" && Number.isFinite(value) && value >= 0,
        `${food.name}: missing ${nutrient}`,
      );
      assert(
        value <=
          (nutrient === "sodiumPerServing"
            ? 40000
            : nutrient === "caloriesPerServing"
              ? 1000
              : 100),
        `${food.name}: invalid ${nutrient}`,
      );
    }
    assert(
      (food.sourceDetails as any)?.referenceComposition === true,
      `${food.name}: missing reference composition label`,
    );
  }
}

export function photoObjectKey(foodId: string, photo: FoodPhoto) {
  assert(/^[0-9a-f-]{36}$/.test(foodId) && /^[0-9a-f]{64}$/.test(photo.sha256));
  return `foods/v1/${foodId}-${photo.sha256.slice(0, 16)}.webp`;
}

export function loadGenericCatalog(
  root = path.resolve(__dirname, ".."),
  requirePhotos = true,
) {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(root, "data/generic_foods.json"), "utf8"),
  );
  assert.equal(catalog.version, FOOD_CATALOG_VERSION);
  validateGenericFoods(catalog.foods);
  if (!requirePhotos)
    return { ...catalog, photos: {} as Record<string, FoodPhoto> };
  const photos = JSON.parse(
    fs.readFileSync(path.join(root, "data/food_images.json"), "utf8"),
  ) as Record<string, FoodPhoto>;
  const publicOrigin = new URL(
    process.env.R2_FOOD_PUBLIC_URL || FOOD_PUBLIC_ORIGIN,
  );
  assert.equal(publicOrigin.protocol, "https:");
  assert(
    !publicOrigin.username &&
      !publicOrigin.password &&
      publicOrigin.pathname === "/" &&
      !publicOrigin.search &&
      !publicOrigin.hash,
  );
  const foods = catalog.foods.map((food: Prisma.NutritionCreateManyInput) => {
    const photo = photos[food.id!];
    assert(photo?.reviewed === true, `${food.name}: photo needs visual review`);
    assert.equal(
      photo.reviewedSha256,
      photo.sha256,
      `${food.name}: image needs review after processing`,
    );
    if (photo.generated) {
      assert(
        photo.author === "Setcraft" &&
          photo.generationTool === "image_gen" &&
          photo.license === "Setcraft original (AI-generated)" &&
          photo.promptFile &&
          fs.existsSync(path.join(root, photo.promptFile)),
        `${food.name}: missing original-image provenance`,
      );
    } else {
      assert(
        /^(CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? (?:[1-4]\.0|2\.5)(?: [a-z]{2})?)$/i.test(
          photo.license,
        ),
        `${food.name}: unsupported photo licence`,
      );
      assert(
        photo.author &&
          /^https:\/\/(?:commons\.wikimedia\.org|(?:www\.)?freefoodphotos\.com)\//.test(
            photo.sourceUrl,
          ) &&
          /^https?:\/\/creativecommons.org\//.test(photo.licenseUrl),
        `${food.name}: incomplete photo credit`,
      );
    }
    const resolved = path.resolve(root, photo.outputFile);
    assert(
      resolved.startsWith(path.resolve(root, "assets/food-images") + path.sep),
      "Image path escapes asset directory",
    );
    const bytes = fs.readFileSync(resolved);
    assert.equal(
      sha256(bytes),
      photo.sha256,
      `${food.name}: image changed since review`,
    );
    assert(
      bytes.length <= 180000 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP",
      `${food.name}: image is not an optimized WebP`,
    );
    const imageUrl = new URL(photoObjectKey(food.id!, photo), publicOrigin)
      .href;
    const creditUrl = new URL(`foods/v1/credits.html#${food.id}`, publicOrigin)
      .href;
    return {
      ...food,
      imageUrl,
      brand: null,
      barcode: null,
      sourceDetails: {
        ...(food.sourceDetails as any),
        image: {
          provider: photo.generated
            ? "Setcraft original"
            : (photo.provider ?? "Wikimedia Commons"),
          title: photo.title,
          sourceUrl: photo.generated ? imageUrl : photo.sourceUrl,
          author: photo.author,
          license: photo.license,
          licenseUrl: photo.licenseUrl,
          creditUrl,
          sha256: photo.sha256,
          transformations: "Resized and cropped to a 512 × 512 WebP thumbnail",
          representative: true,
          generated: photo.generated ?? false,
        },
      },
    };
  });
  return { ...catalog, foods, photos };
}
