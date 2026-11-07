import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";
import { emailBrandingRoutes } from "./utils/email_branding";
import { createPublicMediaRewriter } from "./utils/public_media";

// Database sync reload

import onboardingRoutes from "./modules/onboarding/onboarding_routes";
import authRoutes from "./modules/auth/auth_routes";
import workoutRoutes from "./modules/workout/workout_routes";
import nutritionRoutes from "./modules/nutrition/nutrition_routes";
import readinessRoutes from "./modules/readiness/readiness_routes";
import homeRoutes from "./modules/home/home_routes";
import healthkitRoutes from "./modules/healthkit/healthkit_routes";
import historyRoutes from "./modules/history/history_routes";
import privacyRoutes from "./modules/privacy/privacy_routes";
import supportRoutes from "./modules/support/support_routes";
import { supportPages } from "./modules/support/support_pages";
import {removeDeletedPlannerData} from "./modules/privacy/planner_data_cleanup";
import {prismaApiError} from './utils/api_errors';
import bodyscanRoutes from "./modules/bodyscan/bodyscan_routes";
import heatmapRoutes from "./modules/heatmap/heatmap_routes";
import bodyRoutes from "./modules/body/body_routes";
import progressPhotoRoutes from "./modules/progress/progress_photo_routes";
import { flushBodyPhotoDeletions } from "./modules/body/body_photo_storage";
import progressRoutes from "./modules/progress/progress_routes";
import wellnessRoutes from "./modules/wellness/wellness_routes";
import plannerRoutes from "./graphworkflow/routes";
import { startPlannerWorker } from "./graphworkflow/worker";
import notificationRoutes from "./modules/notifications/notifications_routes";
import { startNotificationsWorker } from "./modules/notifications/notifications_scheduler";
import subscriptionRoutes from "./modules/subscription/subscription_routes";
import { rateLimit, trustedProxies } from "./middleware/rate_limit";
import { mcpRoutes, mcpTokenRoutes } from './modules/mcp/mcp_routes';
import { pruneMcpHistory } from './modules/mcp/mcp_tokens';

const app = express();
const PORT = process.env.PORT || 8000;
const rewritePublicMedia = createPublicMediaRewriter();
app.use((_req, res, next) => {
  const json = res.json;
  res.json = function (body) { return json.call(this, rewritePublicMedia(body)); };
  next();
});
app.set("trust proxy", trustedProxies());
const cleanupBodyPhotos = () => {
  void flushBodyPhotoDeletions().catch((err) =>
    console.warn("Body photo cleanup will retry:", err?.message || err),
  );
};
cleanupBodyPhotos();
setInterval(cleanupBodyPhotos, 60000).unref();
const cleanupPlannerPrivacy = () => {
  void removeDeletedPlannerData().catch((err) =>
    console.warn("Planner privacy cleanup will retry:", err?.message || err),
  );
};
cleanupPlannerPrivacy();
setInterval(cleanupPlannerPrivacy,60000).unref();

// Security and utility middleware
app.use(helmet());
app.use(cors());
app.use(emailBrandingRoutes);
app.use('/support', supportPages);
// Mount before general parsing/logging: bounded MCP payloads, no query/credential logs.
app.use('/mcp', mcpRoutes);
app.use("/api", rateLimit("edge"));
// Support authenticates before parsing the optional, bounded screenshot.
app.use('/api/support', supportRoutes);
// Four 2 MB images need about 11 MB after base64 encoding. Other requests
// should never reserve that much parser memory.
app.use(
  ["/api/body/reviews", "/api/body/entries"],
  express.json({ limit: "12mb" }),
);
app.use('/api/progress-photos', express.json({limit:'3mb'}));
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(morgan("dev", {skip: req => req.path.startsWith('/api/integrations/mcp')}));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Module routes
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/readiness", readinessRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/healthkit", healthkitRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/bodyscan", bodyscanRoutes);
app.use("/api/heatmap", heatmapRoutes);
app.use("/api/body", bodyRoutes);
app.use("/api/progress-photos", progressPhotoRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/wellness", wellnessRoutes);
app.use("/api/plans", plannerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use('/api/integrations/mcp/tokens', mcpTokenRoutes);

app.use((err: Error & { type?: string }, _req: any, res: any, _next: any) => {
  const databaseError=prismaApiError(err);
  if(databaseError){console.warn('Database request failed',{code:(err as any).code??err.name});res.status(databaseError.status).json(databaseError.body);return;}
  if (err.type === "entity.too.large") {
    res
      .status(413)
      .json({
        error: "This upload is too large. Please use smaller photos.",
        code: "PAYLOAD_TOO_LARGE",
      });
    return;
  }
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Setcraft Server running on port ${PORT}`);
  // A second server that cannot bind the port must not run background jobs.
  startPlannerWorker();
  startNotificationsWorker();
  const cleanupMcp = () => {
    void pruneMcpHistory().catch((err) =>
      console.warn("MCP history cleanup will retry:", err?.message || err),
    );
  };
  cleanupMcp();
  setInterval(cleanupMcp, 3600000).unref();
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

export default app;
