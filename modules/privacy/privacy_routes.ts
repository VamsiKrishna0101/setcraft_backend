import { Router } from "express";
import { authenticateStrict as authenticate } from "../../middleware/auth";
import {
    handleExportUserData,
    handleDeleteUserAccount,
    handleGetPrivacyConsent,
    handleUpdatePrivacyConsent,
    handleGetSignInMethods,
} from "./privacy_controller";

const router = Router();

router.use(authenticate);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});

router.get("/export", handleExportUserData);
router.delete("/account", handleDeleteUserAccount);
router.get("/sign-in-methods", handleGetSignInMethods);
router.get("/consent", handleGetPrivacyConsent);
router.put("/consent", handleUpdatePrivacyConsent);

export default router;
