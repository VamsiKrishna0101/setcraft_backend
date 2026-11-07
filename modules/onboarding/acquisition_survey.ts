import { Router } from "express";
import { z } from "zod";
import prisma from "../../config/prisma";
import { validate } from "../../utils/validate";

export const acquisitionResponseSchema = z
  .object({
    source: z
      .enum([
        "INSTAGRAM",
        "TIKTOK",
        "YOUTUBE",
        "APP_STORE",
        "GOOGLE_SEARCH",
        "FRIEND_FAMILY",
        "OTHER",
        "DONT_REMEMBER",
      ])
      .nullable(),
    detail: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.detail ||
      value.source === "OTHER" ||
      value.source === "YOUTUBE" ||
      value.source === "INSTAGRAM" ||
      value.source === "TIKTOK",
    "Details are only available for a creator or other source.",
  );

// Mounted after authenticateStrict. Ownership is always taken from the session.
export const acquisitionSurveyRoutes = Router();
acquisitionSurveyRoutes.get("/", async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.sendStatus(401);
  try {
    const record = await prisma.acquisitionResponse.findUnique({
      where: { userId },
      select: { id: true },
    });
    return res.json({ success: true, data: { completed: record !== null } });
  } catch {
    return res
      .status(503)
      .json({ success: false, message: "Survey unavailable." });
  }
});
acquisitionSurveyRoutes.post(
  "/",
  validate(acquisitionResponseSchema),
  async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.sendStatus(401);
    try {
      // First response wins, including dismissal. Repeated taps cannot duplicate it.
      await prisma.acquisitionResponse.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          source: req.body.source,
          detail: req.body.detail || null,
        },
      });
      return res.json({ success: true, data: { completed: true } });
    } catch {
      return res
        .status(503)
        .json({ success: false, message: "Could not save your answer." });
    }
  },
);
