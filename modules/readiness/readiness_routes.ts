import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePremium } from '../subscription/subscription_service';
import { handleLogReadiness, handleGetUserReadiness } from "./readiness_controller";

const router = Router();

router.use(authenticate);

router.post("/log", requirePremium, handleLogReadiness);
router.post("/", requirePremium, handleLogReadiness);
router.get("/:day/:month/:year", handleGetUserReadiness);
router.get("/", handleGetUserReadiness);

export default router;
