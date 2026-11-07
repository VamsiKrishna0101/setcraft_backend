import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { ProgressPhoto } from "@prisma/client";
import prisma from "../../config/prisma";
import { authenticateStrict } from "../../middleware/auth";
import {
  bodyPhotoStorage,
  queuePhotoDeletion,
  flushBodyPhotoDeletions,
} from "../body/body_photo_storage";
import { BodyError } from "../body/body_types";

const router = Router();
router.use(authenticateStrict);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid photo date.");
const upload = z.object({
  id: z.uuid(),
  recordedDate: date,
  workoutDate: date.optional(),
  base64: z
    .string()
    .min(100)
    .max(2_700_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
const publicBase = () =>
  (
    process.env.R2_PROGRESS_PUBLIC_URL ||
    "https://pub-4bcfc761736c48139b321f10d3e5293c.r2.dev"
  ).replace(/\/$/, "");
const serialize = (p: ProgressPhoto) => ({
  id: p.id,
  recordedDate: p.recordedDate,
  workoutDate: p.workoutDate,
  url: `${publicBase()}/${p.objectKey}`,
  thumbnailUrl: `${publicBase()}/${p.thumbnailKey}`,
});
function handler(action: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error:
              "Choose a valid JPEG or PNG photo under 2 MB and a valid date.",
          });
        return;
      }
      if (error instanceof BodyError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res
        .status(503)
        .json({ error: "Your photos are unavailable. Please try again." });
    }
  };
}
router.get(
  "/",
  handler(async (req, res) => {
    const query = z.object({ cursor: z.uuid().optional() }).parse(req.query);
    const cursor = query.cursor
      ? await prisma.progressPhoto.findFirst({
          where: { id: query.cursor, userId: req.user!.userId },
        })
      : null;
    if (query.cursor && !cursor)
      throw new BodyError(400, "Invalid photo cursor.");
    const photos = await prisma.progressPhoto.findMany({
      where: { userId: req.user!.userId },
      orderBy: [
        { recordedDate: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 31,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
    res.json({
      photos: photos.slice(0, 30).map(serialize),
      nextCursor: photos.length > 30 ? photos[29].id : null,
    });
  }),
);
router.post(
  "/",
  handler(async (req, res) => {
    const input = upload.parse(req.body),
      userId = req.user!.userId;
    const existing = await prisma.progressPhoto.findUnique({
      where: { id: input.id },
    });
    if (existing) {
      if (existing.userId !== userId)
        throw new BodyError(409, "Please select the photo again.");
      res.json(serialize(existing));
      return;
    }
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length > 2_000_000)
      throw new BodyError(400, "Choose a photo under 2 MB.");
    let image: Buffer, thumbnail: Buffer;
    try {
      const source = sharp(bytes, {
        limitInputPixels: 32_000_000,
        animated: false,
      });
      const metadata = await source.metadata();
      if (
        !["jpeg", "png"].includes(metadata.format || "") ||
        (metadata.pages || 1) > 1
      )
        throw new Error("format");
      // Re-encode without EXIF, GPS or other source metadata.
      image = await source
        .rotate()
        .resize(1440, 1800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      thumbnail = await sharp(image)
        .resize(300, 400, { fit: "cover" })
        .jpeg({ quality: 78 })
        .toBuffer();
    } catch {
      throw new BodyError(
        400,
        "This photo could not be opened. Choose a JPEG or PNG.",
      );
    }
    const bucket =
      process.env.R2_PROGRESS_BUCKET_NAME ||
      process.env.R2_BODY_BUCKET_NAME ||
      "fitai-body-images";
    const prefix = `progress/${randomUUID()}`;
    const objectKey = `${prefix}/photo.jpg`,
      thumbnailKey = `${prefix}/thumbnail.jpg`;
    const objects = [
      { bucket, objectKey },
      { bucket, objectKey: thumbnailKey },
    ];
    await prisma.$transaction(async (tx) => {
      for (const p of objects)
        await tx.bodyPhotoDeletion.create({
          data: { ...p, notBefore: new Date(Date.now() + 15 * 60000) },
        });
    });
    try {
      await bodyPhotoStorage.put(bucket, objectKey, image, "image/jpeg");
      await bodyPhotoStorage.put(bucket, thumbnailKey, thumbnail, "image/jpeg");
      const photo = await prisma.$transaction(async (tx) => {
        const result = await tx.progressPhoto.create({
          data: {
            id: input.id,
            userId,
            recordedDate: input.recordedDate,
            workoutDate: input.workoutDate,
            bucket,
            objectKey,
            thumbnailKey,
          },
        });
        for (const p of objects)
          await tx.bodyPhotoDeletion.deleteMany({ where: p });
        return result;
      });
      res.status(201).json(serialize(photo));
    } catch (error) {
      await prisma.$transaction((tx) => queuePhotoDeletion(tx, objects));
      void flushBodyPhotoDeletions().catch(() => {});
      // A simultaneous retry may have committed this upload already.
      const saved = await prisma.progressPhoto.findFirst({
        where: { id: input.id, userId },
      });
      if (saved) {
        res.json(serialize(saved));
        return;
      }
      throw error;
    }
  }),
);
router.delete(
  "/:id",
  handler(async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      userId = req.user!.userId;
    await prisma.$transaction(async (tx) => {
      const photo = await tx.progressPhoto.findFirst({ where: { id, userId } });
      if (!photo) throw new BodyError(404, "Photo not found.");
      await queuePhotoDeletion(tx, [
        { bucket: photo.bucket, objectKey: photo.objectKey },
        { bucket: photo.bucket, objectKey: photo.thumbnailKey },
      ]);
      await tx.progressPhoto.delete({ where: { id } });
    });
    await flushBodyPhotoDeletions();
    res.json({ success: true });
  }),
);
export default router;
