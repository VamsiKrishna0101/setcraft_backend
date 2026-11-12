import { Router } from "express";
import logo from "../assets/branding/setcraft-email-logo.json";
import mochi from "../assets/branding/mochi-coach.json";
import { EMAIL_LOGO_PATH } from "./verification_email";

// Package the exact app icon with tsc's JSON assets, including dist-only deployments.
const logoPng = Buffer.from(logo.base64, "base64");
export const emailBrandingRoutes = Router();
emailBrandingRoutes.get(EMAIL_LOGO_PATH, (_req, res) => {
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("png").send(logoPng);
});

// Mochi, the AI coach, shown as the push notification picture on Android.
// iOS bundles the same artwork in its notification service extension.
export const MOCHI_NOTIFICATION_PATH = "/branding/mochi-coach-v1.png";
const mochiPng = Buffer.from(mochi.base64, "base64");
emailBrandingRoutes.get(MOCHI_NOTIFICATION_PATH, (_req, res) => {
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("png").send(mochiPng);
});

/** Public HTTPS URL for Mochi, or null when no public origin is configured. */
export function mochiNotificationImageUrl(): string | null {
  const explicit = process.env.NOTIFICATION_IMAGE_URL?.trim();
  const origin = explicit ? null : process.env.PUBLIC_APP_URL?.trim();
  try {
    const url = new URL(explicit || `${origin?.replace(/\/+$/, "")}${MOCHI_NOTIFICATION_PATH}`);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
