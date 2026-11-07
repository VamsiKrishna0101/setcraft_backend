import { Router } from "express";
import { authenticate, authenticateStrict } from "../../middleware/auth";
import { requirePremium } from '../subscription/subscription_service';
import { handleCompareScans, handleTrainingMap, handleMuscleCheckIn, handlePlannedPhysiqueMap, handleBodyMap } from "./heatmap_controller";

const router = Router();
router.get("/body", authenticateStrict, handleBodyMap);
router.get("/training", authenticateStrict, handleTrainingMap);
router.get("/plan", authenticateStrict, handlePlannedPhysiqueMap);
router.put("/check-in", authenticateStrict, requirePremium, handleMuscleCheckIn);

// Compare two 3D body scans and generate AI transformation analysis
router.post("/compare", authenticate, handleCompareScans);
router.get("/compare", authenticate, handleCompareScans);

export default router;
