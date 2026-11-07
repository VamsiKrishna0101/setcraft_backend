import { Router } from "express";
import logo from "../assets/branding/setcraft-email-logo.json";
import { EMAIL_LOGO_PATH } from "./verification_email";

// Package the exact app icon with tsc's JSON assets, including dist-only deployments.
const logoPng = Buffer.from(logo.base64, "base64");
export const emailBrandingRoutes = Router();
emailBrandingRoutes.get(EMAIL_LOGO_PATH, (_req, res) => {
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("png").send(logoPng);
});
