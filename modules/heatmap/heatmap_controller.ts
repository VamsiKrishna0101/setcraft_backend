import { getBodyMap } from "./body_map_service";
import { appLocale } from "../../utils/app_locale";
import { Request, Response } from "express";
import { compareScans } from "./heatmap_service";
import { CompareScansRequestSchema } from "./heatmap_types";
import { z } from "zod";
import {
  MUSCLE_IDS,
  calendarWindow,
  TrainingSelection,
} from "./training_map_engine";
import { getTrainingMap, saveMuscleCheckIn } from "./training_map_service";
import { getPlannedPhysiqueMap } from "./planned_physique_service";

const calendarSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840),
  period: z.enum(["day", "week"]).default("week"),
});
const bodyCalendarSchema = calendarSchema.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dates: z.string().min(10).max(4025).optional(),
  all: z.enum(["true", "false"]).optional(),
});

export async function handleBodyMap(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = bodyCalendarSchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "A valid date and UTC offset are required." });
    return;
  }
  let selection: TrainingSelection | undefined;
  try {
    const { date, utcOffsetMinutes: offset, from, dates, all } = parsed.data;
    calendarWindow(date, offset);
    if ([!!from, !!dates, all === "true"].filter(Boolean).length > 1)
      throw new Error();
    if (from) {
      calendarWindow(from, offset);
      if (from > date) throw new Error();
      selection = { from };
    } else if (dates) {
      const selected = [...new Set(dates.split(","))].sort();
      if (selected.length > 366) throw new Error();
      for (const day of selected) {
        calendarWindow(day, offset);
        if (day > date) throw new Error();
      }
      selection = { dates: selected };
    } else if (all === "true") selection = { all: true };
    const today = new Date(Date.now() + offset * 60000)
      .toISOString()
      .slice(0, 10);
    if (selection && date > today) throw new Error();
  } catch {
    res.status(400).json({ error: "Invalid training dates." });
    return;
  }
  try {
    res.json(
      await getBodyMap(
        req.user.userId,
        parsed.data.date,
        parsed.data.utcOffsetMinutes,
        req.headers["accept-language"]
          ? appLocale(req.headers["accept-language"])
          : undefined,
        selection,
      ),
    );
  } catch {
    res.status(500).json({ error: "Could not load your muscle map." });
  }
}

export async function handlePlannedPhysiqueMap(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = calendarSchema.safeParse(req.query);
  if (!req.user?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "A valid date and UTC offset are required." });
    return;
  }
  try {
    calendarWindow(parsed.data.date, parsed.data.utcOffsetMinutes);
  } catch {
    res.status(400).json({ error: "Invalid calendar date." });
    return;
  }
  try {
    res.json(
      await getPlannedPhysiqueMap(
        req.user.userId,
        parsed.data.date,
        parsed.data.utcOffsetMinutes,
        req.headers["accept-language"]
          ? appLocale(req.headers["accept-language"])
          : undefined,
      ),
    );
  } catch {
    res.status(500).json({ error: "Could not load your planned muscle map." });
  }
}

export async function handleTrainingMap(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = calendarSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A date and UTC offset are required." });
    return;
  }
  try {
    calendarWindow(parsed.data.date, parsed.data.utcOffsetMinutes);
  } catch {
    res.status(400).json({ error: "Invalid calendar date." });
    return;
  }
  try {
    res.json(
      await getTrainingMap(
        req.user.userId,
        parsed.data.date,
        parsed.data.utcOffsetMinutes,
        req.headers["accept-language"]
          ? appLocale(req.headers["accept-language"])
          : undefined,
        parsed.data.period,
      ),
    );
  } catch (error) {
    console.error("Training map load failed", error);
    res.status(500).json({ error: "Could not load your training map." });
  }
}

export async function handleMuscleCheckIn(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = calendarSchema
    .extend({
      muscleId: z.enum(MUSCLE_IDS),
      soreness: z.number().int().min(0).max(3),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid muscle check-in." });
    return;
  }
  const { date, utcOffsetMinutes, muscleId, soreness } = parsed.data;
  const today = new Date(Date.now() + utcOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
  if (date !== today) {
    res
      .status(400)
      .json({ error: "Check-ins can only be recorded for today." });
    return;
  }
  try {
    res.json(
      await saveMuscleCheckIn(req.user.userId, muscleId, date, soreness),
    );
  } catch (error) {
    console.error("Muscle check-in save failed", error);
    res.status(500).json({ error: "Could not save your check-in." });
  }
}

// Computes arithmetic comparisons between two saved scan records.
export async function handleCompareScans(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Accepts IDs from either query string or JSON body
    const params = {
      scan1Id: (req.query.scan1Id || req.body?.scan1Id) as string | undefined,
      scan2Id: (req.query.scan2Id || req.body?.scan2Id) as string | undefined,
    };

    const validated = CompareScansRequestSchema.parse(params);
    const comparison = await compareScans(
      userId,
      validated.scan1Id,
      validated.scan2Id,
    );

    res.status(200).json(comparison);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: error.message || "Failed to compare body scans" });
  }
}
