import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  FOOD_BUCKET,
  loadGenericCatalog,
  photoObjectKey,
  sha256,
} from "../utils/generic_food_catalog";

const root = path.resolve(__dirname, "..");
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const catalog = loadGenericCatalog(root);
  const upload = process.argv.includes("--upload"),
    check = process.argv.includes("--check");
  assert.equal(
    process.env.R2_FOOD_BUCKET_NAME || FOOD_BUCKET,
    FOOD_BUCKET,
    "Only the user-named food bucket can be modified",
  );
  if (!upload && !check) {
    console.log({
      mode: "dry run",
      bucket: FOOD_BUCKET,
      reviewedFoods: catalog.foods.length,
      images: catalog.foods.length,
      additionalFiles: ["foods/v1/credits.html", "foods/v1/credits.json"],
    });
    return;
  }
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    maxAttempts: 3,
  });
  const verified: { foodId: string; url: string; sha256: string }[] = [];
  const credits: Record<string, any>[] = [];
  try {
    for (const food of catalog.foods) {
      const photo = catalog.photos[food.id!];
      const key = photoObjectKey(food.id!, photo);
      const bytes = fs.readFileSync(path.join(root, photo.outputFile));
      if (upload) {
        let existing = false;
        try {
          const current = await s3.send(
            new HeadObjectCommand({ Bucket: FOOD_BUCKET, Key: key }),
          );
          existing =
            current.Metadata?.sha256 === photo.sha256 &&
            current.ContentLength === bytes.length;
        } catch (error: any) {
          if (
            error.$metadata?.httpStatusCode !== 404 &&
            error.name !== "NotFound"
          )
            throw error;
        }
        if (!existing)
          await s3.send(
            new PutObjectCommand({
              Bucket: FOOD_BUCKET,
              Key: key,
              Body: bytes,
              ContentType: "image/webp",
              CacheControl: "public, max-age=31536000, immutable",
              Metadata: {
                sha256: photo.sha256,
                "source-sha256": photo.sourceSha256,
              },
            }),
          );
      }
      let delivered = false;
      for (let retry = 0; retry < 4; retry++) {
        const response = await fetch(food.imageUrl!, {
          signal: AbortSignal.timeout(20000),
        });
        if (response.status === 429 || response.status === 503) {
          await response.body?.cancel();
          await pause(5000 * (retry + 1));
          continue;
        }
        assert.equal(
          response.status,
          200,
          `${food.name}: public image unavailable`,
        );
        assert(
          response.headers.get("content-type")?.startsWith("image/webp"),
          `${food.name}: incorrect public content type`,
        );
        assert.equal(
          sha256(Buffer.from(await response.arrayBuffer())),
          photo.sha256,
          `${food.name}: public image bytes differ`,
        );
        delivered = true;
        break;
      }
      assert(
        delivered,
        `${food.name}: public image delivery remains unavailable`,
      );
      verified.push({
        foodId: food.id!,
        url: food.imageUrl!,
        sha256: photo.sha256,
      });
      credits.push({
        foodId: food.id,
        name: food.name,
        imageUrl: food.imageUrl,
        ...food.sourceDetails.image,
      });
      if (verified.length % 25 === 0)
        console.log(
          `Verified ${verified.length}/${catalog.foods.length} public food images`,
        );
    }
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setcraft food image credits</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;background:#fafafa;color:#18181b}article{padding:24px 0;border-top:1px solid #ddd;scroll-margin-top:24px}img{width:128px;height:128px;border-radius:16px}a{color:inherit}h1{line-height:1.2}small{color:#52525b}</style><h1>Setcraft food image credits</h1><p>Representative food images, including original AI-generated illustrations where labelled. Nutrition comes from separate reference composition sources; images do not define serving size or a specific product.</p>${credits.map((c) => `<article id="${c.foodId}"><h2>${escapeHtml(c.name)}</h2><img loading="lazy" src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.name)}"><p>Image: ${escapeHtml(c.author)} · <a href="${escapeHtml(c.sourceUrl)}">${c.generated ? "Generated representative image" : "Original photograph"}</a> · ${c.generated ? escapeHtml(c.license) : `<a href="${escapeHtml(c.licenseUrl)}">${escapeHtml(c.license)}</a>`}</p><small>${escapeHtml(c.transformations)}. Adapted images retain the original licence where required.</small></article>`).join("")}</html>`;
    const creditsJson = JSON.stringify(
      { version: catalog.version, images: credits },
      null,
      2,
    );
    if (upload) {
      for (const [key, body, type] of [
        ["foods/v1/credits.html", html, "text/html; charset=utf-8"],
        ["foods/v1/credits.json", creditsJson, "application/json"],
      ])
        await s3.send(
          new PutObjectCommand({
            Bucket: FOOD_BUCKET,
            Key: key!,
            Body: body!,
            ContentType: type!,
            CacheControl: "public, max-age=1800",
          }),
        );
    }
    const creditsUrl = new URL(
      "foods/v1/credits.html",
      foodOrigin(catalog.foods[0].imageUrl),
    ).href;
    const creditsResponse = await fetch(creditsUrl, {
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(
      creditsResponse.status,
      200,
      "Public photo credits must be available before the catalogue switches",
    );
    assert.equal(
      sha256(await creditsResponse.text()),
      sha256(html),
      "Public photo credits differ from reviewed data",
    );
    const receipt = {
      verifiedAt: new Date().toISOString(),
      bucket: FOOD_BUCKET,
      catalogSha256: sha256(
        fs.readFileSync(path.join(root, "data/generic_foods.json")),
      ),
      verified,
      creditsUrl,
    };
    fs.mkdirSync(path.join(root, "build/food-catalog"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "build/food-catalog/images-uploaded.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log({
      verifiedImages: verified.length,
      bucket: FOOD_BUCKET,
      creditsUrl,
    });
  } finally {
    s3.destroy();
  }
}
function foodOrigin(imageUrl: string) {
  return new URL(imageUrl).origin;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
