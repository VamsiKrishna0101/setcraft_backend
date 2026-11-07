import { Request, Response, NextFunction } from "express";
import {
    StrengthHistoryQuerySchema,
    NutritionHistoryQuerySchema,
    RecoveryHistoryQuerySchema,
    BodyHistoryQuerySchema,
    WorkoutCompletionQuerySchema,
    VolumeHistoryQuerySchema,
} from "./history_types";
import {
    getStrengthHistory,
    getNutritionHistory,
    getRecoveryHistory,
    getBodyHistory,
    getWorkoutCompletion,
    getVolumeHistory,
} from "./history_service";

export async function handleGetStrengthHistory(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = StrengthHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getStrengthHistory(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetNutritionHistory(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = NutritionHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getNutritionHistory(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetRecoveryHistory(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = RecoveryHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getRecoveryHistory(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetBodyHistory(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = BodyHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getBodyHistory(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetWorkoutCompletion(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = WorkoutCompletionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getWorkoutCompletion(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleGetVolumeHistory(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = VolumeHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await getVolumeHistory(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}
