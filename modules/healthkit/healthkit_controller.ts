import { Request, Response, NextFunction } from "express";
import { HealthkitInputSchema, SnapshotQuerySchema } from "./healthkit_types";
import { syncHealthKit, getSnapshot, getImportedWorkouts } from "./healthkit_service";
import { calendarDate } from '../progress/progress_types';

export async function handleSyncHealthKit(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = HealthkitInputSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const result = await syncHealthKit(userId, parsed.data);
        res.status(201).json({ message: "HealthKit data synced", data: result });
    } catch (e) {
        next(e);
    }
}

export async function handleImportedWorkouts(req: Request, res: Response, next: NextFunction) {
    const date = calendarDate.safeParse(req.query.date);
    if (!date.success) { res.status(400).json({ error: 'A valid calendar date is required.' }); return; }
    try { res.json({ data: await getImportedWorkouts(req.user!.userId, date.data) }); }
    catch (error) { next(error); }
}

export async function handleGetSnapshot(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = SnapshotQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const snapshot = await getSnapshot(userId, parsed.data.date);
        res.status(200).json({ data: snapshot });
    } catch (e) {
        next(e);
    }
}
