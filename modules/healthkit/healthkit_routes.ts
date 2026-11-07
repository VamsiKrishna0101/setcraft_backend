import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { handleSyncHealthKit, handleGetSnapshot, handleImportedWorkouts } from "./healthkit_controller";

const router = Router();

router.use(authenticate);

router.post("/sync", handleSyncHealthKit);
router.get("/snapshot", handleGetSnapshot);
router.get("/workouts", handleImportedWorkouts);

export default router;
