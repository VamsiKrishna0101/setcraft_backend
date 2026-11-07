import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { getHome } from "./home_controller";

const router = Router();

router.get("/", authenticate, getHome);

export default router;
