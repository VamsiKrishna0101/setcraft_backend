import { Router } from "express";
import { authenticateStrict } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rate_limit";
import { handleSocialExchange } from './social_auth_controller';
import {
  handleSendOtp,
  handleVerifyOtp,
  handleRegister,
  handleLogin,
  handleGetUserDetails,
  handleRefresh,
} from "./auth_controller";

const router = Router();

router.post("/send-otp", rateLimit("sendOtp"), handleSendOtp);
router.post("/verify-otp", rateLimit("verifyOtp"), handleVerifyOtp);
router.post("/register", rateLimit("register"), handleRegister);
router.post("/login", rateLimit("login"), handleLogin);
router.post("/social", rateLimit("socialAuth"), handleSocialExchange);
router.post("/refresh", rateLimit("refresh"), handleRefresh);
router.get("/user/:userId", authenticateStrict, handleGetUserDetails);

export default router;
