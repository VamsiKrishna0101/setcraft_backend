import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// MARK: - Cloudflare R2 Bulk Image Uploader (1,324 Images)
// Cloudflare R2 S3 Endpoint format:
// https://<ACCOUNT_ID>.r2.cloudflarestorage.com

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "fitai";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.log(`
ℹ️  Cloudflare R2 S3 Credentials Missing in .env:
   Please set the following in your backend/.env to run automated upload:
     R2_ACCOUNT_ID="your-cloudflare-account-id"
     R2_ACCESS_KEY_ID="your-r2-access-key-id"
     R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
     R2_BUCKET_NAME="your-bucket-name"

   Alternatively, you can drag-and-drop the entire "backend/images" folder directly
   into your Cloudflare R2 Dashboard (under the "images/" prefix).
`);
  process.exit(0);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function uploadImages() {
  const imagesDir = path.join(__dirname, "../images");
  if (!fs.existsSync(imagesDir)) {
    console.error(`Cannot find images folder at: ${imagesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(imagesDir).filter((f) => f.endsWith(".jpg"));
  console.log(`🚀 Found ${files.length} JPG images in ${imagesDir}. Starting upload to R2 bucket "${bucketName}"...`);

  let completed = 0;
  let failed = 0;

  // Concurrency pool (batch 15 files at a time)
  const concurrency = 15;
  for (let i = 0; i < files.length; i += concurrency) {
    const slice = files.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (filename) => {
        const filePath = path.join(imagesDir, filename);
        const fileBuffer = fs.readFileSync(filePath);

        try {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: `images/${filename}`,
              Body: fileBuffer,
              ContentType: "image/jpeg",
              CacheControl: "public, max-age=31536000, immutable",
            })
          );
          completed++;
        } catch (err: any) {
          failed++;
          console.error(`Error uploading ${filename}:`, err.message);
        }
      })
    );

    process.stdout.write(
      `Progress: ${completed + failed}/${files.length} (${completed} succeeded, ${failed} failed)\r`
    );
  }

  console.log(`\n\n🎉 Finished uploading images to R2!`);
  console.log(`Total Succeeded: ${completed}`);
  console.log(`Total Failed: ${failed}`);
}

uploadImages().catch(console.error);
