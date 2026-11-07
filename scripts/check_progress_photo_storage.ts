import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { bodyPhotoStorage } from "../modules/body/body_photo_storage";

// A generated swatch only; never reads or uploads member photographs.
async function main() {
  const bucket =
    process.env.R2_PROGRESS_BUCKET_NAME ||
    process.env.R2_BODY_BUCKET_NAME ||
    "fitai-body-images";
  const key = `verification/progress-${randomUUID()}.jpg`;
  const data = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#67D7B0" },
  })
    .jpeg()
    .toBuffer();
  try {
    await bodyPhotoStorage.put(bucket, key, data, "image/jpeg");
    assert((await bodyPhotoStorage.get(bucket, key)).equals(data));
    const base = (
      process.env.R2_PROGRESS_PUBLIC_URL ||
      "https://pub-4bcfc761736c48139b321f10d3e5293c.r2.dev"
    ).replace(/\/$/, "");
    const response = await fetch(`${base}/${key}`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(
      response.status,
      200,
      "The supplied public URL must serve progress photos.",
    );
    assert(Buffer.from(await response.arrayBuffer()).equals(data));
    console.log(
      "R2 synthetic upload, authenticated read and supplied public URL passed.",
    );
  } finally {
    await bodyPhotoStorage.remove(bucket, key);
    console.log("Synthetic verification image deleted.");
  }
}
main().catch((error) => {
  console.error(
    "Progress photo storage check failed:",
    error instanceof assert.AssertionError
      ? error.message
      : (error as { name?: string }).name,
  );
  process.exitCode = 1;
});
