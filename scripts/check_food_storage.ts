import "dotenv/config";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import prisma from "../config/prisma";

async function main() {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    maxAttempts: 1,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: "fitai-food-images" }));
    console.log("Food bucket: accessible with existing backend credentials");
    console.log({
      activeSharedFoods: await prisma.nutrition.count({
        where: { userId: null, isArchived: false },
      }),
      privateFoods: await prisma.nutrition.count({
        where: { userId: { not: null } },
      }),
      mealLogs: await prisma.userMealLog.count(),
      planItems: await prisma.userMealPlanItem.count(),
    });
  } finally {
    s3.destroy();
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error("Food storage check failed:", error.name, error.message);
  process.exitCode = 1;
});
