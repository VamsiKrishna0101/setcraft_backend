import { Request, Response, NextFunction } from "express";
import { ReadinessInputSchema, userReadinessSchema } from "./readiness_types";
import { logReadiness, getUserReadiness } from "./readiness_service";

export async function handleLogReadiness(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = ReadinessInputSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const score = await logReadiness(parsed.data, userId);
        res.status(201).json({ message: "Readiness score logged", data: score });
    } catch (e) {
        next(e);
    }
}

export async function handleGetUserReadiness(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const now = new Date();
    const day = (req.params.day || req.query.day || String(now.getDate())) as string;
    const month = (req.params.month || req.query.month || String(now.getMonth() + 1).padStart(2, "0")) as string;
    const year = (req.params.year || req.query.year || String(now.getFullYear())) as string;

    const parsed = userReadinessSchema.safeParse({ day, month, year });
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const score = await getUserReadiness(parsed.data, userId);
        res.status(200).json({ data: score });
    } catch (e) {
        next(e);
    }
}
