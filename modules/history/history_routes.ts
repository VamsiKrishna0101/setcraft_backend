import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import {
    handleGetStrengthHistory,
    handleGetNutritionHistory,
    handleGetRecoveryHistory,
    handleGetBodyHistory,
    handleGetWorkoutCompletion,
    handleGetVolumeHistory,
} from "./history_controller";

const router = Router();

router.use(authenticate);

router.get("/strength", handleGetStrengthHistory);
router.get("/nutrition", handleGetNutritionHistory);
router.get("/recovery", handleGetRecoveryHistory);
router.get("/body", handleGetBodyHistory);
router.get("/completion", handleGetWorkoutCompletion);
router.get("/volume", handleGetVolumeHistory);

export default router;
