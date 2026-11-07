// Synthetic in-process HTTP tests; no database, R2 or member data touched.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { inject } from "light-my-request";
import prisma from "../config/prisma";
import router from "../modules/progress/progress_photo_routes";
import { bodyPhotoStorage } from "../modules/body/body_photo_storage";
import { rateLimitStore } from "../middleware/rate_limit";

const restores: Array<() => void> = [];
function stub(target: any, key: string, value: any) {
  const old = target[key];
  target[key] = value;
  restores.push(() => (target[key] = old));
}
async function main() {
  const originalSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = "synthetic-progress-photo-test";
  const owner = randomUUID(),
    other = randomUUID(),
    photos: any[] = [],
    markers: any[] = [],
    objects = new Map<string, Buffer>();
  let failUpload = false,
    puts = 0;
  stub(prisma.user, "findUnique", async ({ where }: any) => ({
    id: where.id,
    email: "synthetic@example.invalid",
    role: "USER",
  }));
  stub(rateLimitStore, "consume", async () => ({
    allowed: true,
    retryAfterSeconds: 0,
  }));
  stub(prisma, "$transaction", async (action: any) => action(prisma));
  stub(
    prisma.progressPhoto,
    "findUnique",
    async ({ where }: any) => photos.find((p) => p.id === where.id) || null,
  );
  stub(
    prisma.progressPhoto,
    "findFirst",
    async ({ where }: any) =>
      photos.find((p) => p.id === where.id && p.userId === where.userId) ||
      null,
  );
  stub(
    prisma.progressPhoto,
    "findMany",
    async ({ where, take, cursor, skip = 0 }: any) => {
      const all = photos
        .filter((p) => p.userId === where.userId)
        .sort(
          (a, b) =>
            b.recordedDate.localeCompare(a.recordedDate) ||
            b.id.localeCompare(a.id),
        );
      return all
        .slice(cursor ? all.findIndex((p) => p.id === cursor.id) + skip : 0)
        .slice(0, take);
    },
  );
  stub(prisma.progressPhoto, "create", async ({ data }: any) => {
    const photo = { ...data, createdAt: new Date() };
    photos.push(photo);
    return photo;
  });
  stub(
    prisma.progressPhoto,
    "delete",
    async ({ where }: any) =>
      photos.splice(
        photos.findIndex((p) => p.id === where.id),
        1,
      )[0],
  );
  stub(
    prisma.progressPhoto,
    "count",
    async ({ where }: any) =>
      photos.filter(
        (p) =>
          p.bucket === where.bucket &&
          where.OR.some(
            (q: any) =>
              q.objectKey === p.objectKey || q.thumbnailKey === p.thumbnailKey,
          ),
      ).length,
  );
  stub(prisma.bodyAssessmentPhoto, "count", async () => 0);
  stub(prisma.bodyPhotoDeletion, "create", async ({ data }: any) => {
    markers.push({ ...data, id: randomUUID() });
  });
  stub(prisma.bodyPhotoDeletion, "findMany", async () =>
    markers.filter((p) => p.notBefore <= new Date()),
  );
  stub(prisma.bodyPhotoDeletion, "deleteMany", async ({ where }: any) => {
    for (let i = markers.length - 1; i >= 0; i--)
      if (
        where.id
          ? markers[i].id === where.id
          : markers[i].objectKey === where.objectKey
      )
        markers.splice(i, 1);
  });
  stub(
    prisma.bodyPhotoDeletion,
    "upsert",
    async ({ where, create, update }: any) => {
      const old = markers.find(
        (p) => p.objectKey === where.bucket_objectKey.objectKey,
      );
      if (old) Object.assign(old, update);
      else markers.push({ ...create, id: randomUUID(), notBefore: new Date() });
    },
  );
  stub(
    bodyPhotoStorage,
    "put",
    async (_bucket: string, key: string, data: Buffer) => {
      puts++;
      if (failUpload) throw new Error("synthetic outage");
      objects.set(key, data);
    },
  );
  stub(bodyPhotoStorage, "remove", async (_bucket: string, key: string) => {
    objects.delete(key);
  });
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/progress-photos", router);
  const request = (method: any, path = "", payload?: any, userId = owner) =>
    inject(app, {
      method,
      url: `/api/progress-photos${path}`,
      payload,
      headers: {
        authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!)}`,
      },
    });
  const input = {
    id: randomUUID(),
    recordedDate: "2026-11-05",
    workoutDate: "2026-11-05",
    base64: (
      await sharp({
        create: { width: 100, height: 150, channels: 3, background: "#67D7B0" },
      })
        .jpeg()
        .withExif({ IFD0: { Artist: "remove me" } })
        .toBuffer()
    ).toString("base64"),
  };
  try {
    assert.equal(
      (await inject(app, { method: "GET", url: "/api/progress-photos" }))
        .statusCode,
      401,
    );
    assert.equal(
      (await request("POST", "", { ...input, recordedDate: "2026-02-30" }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", "", {
          ...input,
          base64: Buffer.alloc(100, 1).toString("base64"),
        })
      ).statusCode,
      400,
    );
    const saved = await request("POST", "", input);
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(photos.length, 1);
    assert.equal(objects.size, 2);
    assert.equal(markers.length, 0);
    const metadata = await sharp(objects.get(photos[0].objectKey)!).metadata();
    assert.equal(
      metadata.exif,
      undefined,
      "Saved images must omit source metadata",
    );
    const thumb = await sharp(objects.get(photos[0].thumbnailKey)!).metadata();
    assert.equal(thumb.width, 300);
    assert.equal(thumb.height, 400);
    assert.equal((await request("POST", "", input)).statusCode, 200);
    assert.equal(puts, 2, "Retry must reuse the committed photo");
    assert.equal((await request("POST", "", input, other)).statusCode, 409);
    assert.equal(
      JSON.parse((await request("GET", "", undefined, other)).body).photos
        .length,
      0,
    );
    assert.equal(
      (await request("GET", `?cursor=${input.id}`, undefined, other))
        .statusCode,
      400,
    );
    assert.equal(
      (await request("DELETE", `/${input.id}`, undefined, other)).statusCode,
      404,
    );
    const listed = JSON.parse((await request("GET")).body);
    assert.ok(listed.photos[0].thumbnailUrl.includes("/progress/"));
    assert.equal(listed.nextCursor, null);
    assert.equal((await request("DELETE", `/${input.id}`)).statusCode, 200);
    assert.equal(photos.length, 0);
    assert.equal(objects.size, 0);
    failUpload = true;
    assert.equal(
      (await request("POST", "", { ...input, id: randomUUID() })).statusCode,
      503,
    );
    assert.equal(photos.length, 0);
    console.log(
      "Progress photos: authentication, ownership, validation, metadata removal, thumbnails, retries, deletion and upload failure passed.",
    );
  } finally {
    restores.reverse().forEach((restore) => restore());
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
