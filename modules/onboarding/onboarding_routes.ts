import { Router } from "express";
import {
  handleCreateOnboarding,
  handleGetOnboarding,
  handleUpdateOnboarding,
} from "./onboarding_controller";
import { authenticateStrict } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { acquisitionSurveyRoutes } from "./acquisition_survey";
import {
  createOnboardingSchema,
  updateOnboardingSchema,
} from "./onboarding_types";

const router = Router();

router.use(authenticateStrict);
router.use("/discovery", acquisitionSurveyRoutes);

router.post("/", validate(createOnboardingSchema), handleCreateOnboarding);
router.get("/", handleGetOnboarding);
router.patch("/", validate(updateOnboardingSchema), handleUpdateOnboarding);

export default router;
