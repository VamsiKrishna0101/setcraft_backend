import { Router } from "express";
import { authenticateStrict } from "../../middleware/auth";
import { subscriptionTestPages } from './subscription_test_pages';
import {
  googleNotification,
  revenueCatNotification,
  revenueCatSync,
  status,
  pricing,
  trial,
  verify,
  verifyIos,
  appleNotification,
} from "./subscription_controller";
import { validateCreatorCode, applyCreatorCode, getCreatorReport } from "./creator_controller";

const router = Router();
router.use(subscriptionTestPages);
router.post("/creator-code/validate", validateCreatorCode);

// Pub/Sub verifies Google's identity; it never accepts a user's JWT as publisher proof.
router.post("/google/notifications", googleNotification);
router.post('/apple/notifications', appleNotification);
router.post("/revenuecat/webhook", revenueCatNotification);
router.use(authenticateStrict);
router.post("/revenuecat/sync", revenueCatSync);
router.get("/status", status);
router.get("/pricing", pricing);
router.post("/start-trial", trial);
router.post("/trial", trial);
router.post("/android/verify", verify);
router.post('/ios/verify', verifyIos);
router.post("/creator-code/apply", applyCreatorCode);
router.get("/creator-code/report", getCreatorReport);

export default router;
