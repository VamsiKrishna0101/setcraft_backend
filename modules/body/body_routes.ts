import { Router, Request, Response } from "express";
import { authenticateStrict } from "../../middleware/auth";
import {
  BodyError,
  entrySchema,
  saveReviewSchema,
  validateEntryDate,
} from "./body_types";
import {
  cancelReviewJob,
  createBodyEntry,
  deleteBodyEntry,
  deleteBodyPhotos,
  getAssessment,
  getBodyComparison,
  getBodyOverview,
  getBodyHistory,
  saveBodyReview,
} from "./body_service";
import { readBodyPhoto } from "./body_photo_storage";
import prisma from "../../config/prisma";
import { z } from "zod";


const router = Router();
router.use(authenticateStrict);
// Entered measurements must be available before the starter plan and checkout.
// Keep historical photo deletion available, but retire every analysis endpoint.
const retiredPhotoFeature = (_req: Request, res: Response) => {
  res.status(410).json({code: 'PHOTO_SCANS_REMOVED',
    error: 'Photo scans are no longer available. Add measurements instead.'});
};
router.post('/reviews', retiredPhotoFeature);
router.get('/review-jobs/:id', retiredPhotoFeature);
router.post('/entries/:id/focus', retiredPhotoFeature);
router.patch('/entries/:id/readings', retiredPhotoFeature);
function handler(action: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues[0]?.message || "Invalid body data." });
        return;
      }
      if (error instanceof BodyError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res
        .status(500)
        .json({ error: "Could not complete this body request. Please retry." });
    }
  };
}
router.get(
  "/",
  handler(async (req, res) =>
    res.json(await getBodyOverview(req.user!.userId)),
  ),
);
router.get(
  "/history",
  handler(async (req, res) => {
    const input = z
      .object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .refine(
        (value) => !value.from || !value.to || value.from <= value.to,
        "Choose an end date after the start date.",
      )
      .parse(req.query);
    res
      .set("Cache-Control", "private, no-store")
      .json(await getBodyHistory(req.user!.userId, input));
  }),
);
router.post(
  "/entries",
  handler(async (req, res) => {
    const input = entrySchema.parse(req.body);
    if (input.photos.length || input.savePhotos || input.requestCoaching ||
      Object.values(input.metrics).some(metric => metric &&
        ['photo_estimate', 'contour_estimate'].includes(metric.source))) {
      retiredPhotoFeature(req, res);
      return;
    }
    validateEntryDate(input.recordedDate, input.utcOffsetMinutes);
    res.status(201).json(await createBodyEntry(req.user!.userId, input));
  }),
);
router.delete(
  "/review-jobs/:id",
  handler(async (req, res) => {
    await cancelReviewJob(req.user!.userId, String(req.params.id));
    res.json({ success: true });
  }),
);
router.get(
  "/compare",
  handler(async (req, res) => {
    const input = z
      .object({ currentId: z.string().uuid(), previousId: z.string().uuid() })
      .parse(req.query);
    res.json(
      await getBodyComparison(
        req.user!.userId,
        input.currentId,
        input.previousId,
      ),
    );
  }),
);
router.get(
  "/entries/:id",
  handler(async (req, res) =>
    res.json(await getAssessment(req.user!.userId, String(req.params.id))),
  ),
);
router.patch(
  "/entries/:id",
  handler(async (req, res) =>
    res.json(
      await saveBodyReview(
        req.user!.userId,
        String(req.params.id),
        saveReviewSchema.parse(req.body),
      ),
    ),
  ),
);
router.delete(
  "/entries/:id",
  handler(async (req, res) => {
    await deleteBodyEntry(req.user!.userId, String(req.params.id));
    res.json({ success: true });
  }),
);
router.delete(
  "/entries/:id/photos",
  handler(async (req, res) =>
    res.json(await deleteBodyPhotos(req.user!.userId, String(req.params.id))),
  ),
);
router.get(
  "/photos/:id",
  handler(async (req, res) => {
    const photo = await prisma.bodyAssessmentPhoto.findFirst({
      where: {
        id: String(req.params.id),
        assessment: { userId: req.user!.userId },
      },
    });
    if (!photo) throw new BodyError(404, "Photo not found.");
    const bytes = await readBodyPhoto(photo);
    // Recheck after storage I/O: an assessment may have been deleted while loading.
    if (
      !(await prisma.bodyAssessmentPhoto.count({
        where: { id: photo.id, assessment: { userId: req.user!.userId } },
      }))
    )
      throw new BodyError(404, "Photo not found.");
    res
      .set({
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(bytes);
  }),
);
export default router;
