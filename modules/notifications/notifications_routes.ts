import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import * as controller from "./notifications_controller";
import { rateLimit } from "../../middleware/rate_limit";

const router = Router();

router.use(authenticate);
router.get("/preferences", controller.preferences);
router.post("/:id/opened", controller.opened);
router.post("/:id/snooze", rateLimit("notificationTest"), controller.snooze);
router.patch("/preferences", controller.updatePreferences);
router.put("/device", controller.device);
router.delete("/device/:id", controller.deleteDevice);
router.post("/test", rateLimit("notificationTest"), controller.test);

export default router;
