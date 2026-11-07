import { Request, Response } from "express";
import {
    createOnboarding,
    getOnboardinguser,
    updateOnboardinguser,
} from "./onboarding_service";

export async function handleCreateOnboarding(req: Request, res: Response) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await createOnboarding(userId, req.body);

        return res.status(201).json({
            success: true,
            data: result,
        });
    } catch (error: any) {
        if (error.message === "User has already onboarded") {
            return res.status(409).json({
                success: false,
                message: error.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to create onboarding profile",
        });
    }
}

export async function handleGetOnboarding(req: Request, res: Response) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const user = await getOnboardinguser(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Onboarding profile not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: user,
        });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to fetch onboarding profile",
        });
    }
}

export async function handleUpdateOnboarding(req: Request, res: Response) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const updated = await updateOnboardinguser(userId, req.body);

        return res.status(200).json({
            success: true,
            data: updated,
        });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to update onboarding profile",
        });
    }
}
