import { Request, Response, NextFunction } from "express";
import { ConsentUpdateSchema } from "./privacy_types";
import { SupportError } from '../support/support_types';
import {
    exportUserData,
    deleteUserAccount,
    getPrivacyConsent,
    updatePrivacyConsent,
} from "./privacy_service";

export async function handleExportUserData(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const data = await exportUserData(userId);
        res.status(200).json(data);
    } catch (e) {
        next(e);
    }
}

export async function handleDeleteUserAccount(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const result = await deleteUserAccount(userId);
        res.status(200).json(result);
    } catch (e) {
        next(e);
    }
}

export async function handleGetPrivacyConsent(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const data = await getPrivacyConsent(userId);
        res.status(200).json({ data });
    } catch (e) {
        next(e);
    }
}

export async function handleUpdatePrivacyConsent(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.userId || (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const parsed = ConsentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    try {
        const data = await updatePrivacyConsent(userId, parsed.data);
        res.status(200).json({ data });
    } catch (e) {
        if(e instanceof SupportError) { res.status(e.status).json({error:e.message}); return; }
        next(e);
    }
}
