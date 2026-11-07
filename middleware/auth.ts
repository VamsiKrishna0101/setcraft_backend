import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { rateLimit } from "./rate_limit";
import { exercisePresentation } from '../utils/exercise_media';

const generalLimit = rateLimit("general");

// Extend Express Request to carry authenticated user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: Role;
      };
    }
  }
}

// ─── Authenticate ────────────────────────────────────────────────────────────
// Verifies the Bearer JWT, fetches the user's role from the DB and attaches
// { userId, email, role } to req.user for downstream handlers.
export const authenticate = authenticateStrict;

// ─── requireRole ─────────────────────────────────────────────────────────────
// Personal health/preferences endpoints never use development impersonation.
export async function authenticateStrict(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let presentationGender: string | undefined;
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  if (!match || !process.env.JWT_ACCESS_SECRET) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(match[1], process.env.JWT_ACCESS_SECRET);
    if (typeof payload === "string" || typeof payload.userId !== "string") {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const { default: prisma } = await import("../config/prisma");
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, onboarding: {select: {gender:true}} },
    });
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = { userId: user.id, email: user.email, role: user.role };
    presentationGender = user.onboarding?.gender;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  return exercisePresentation.run({gender:presentationGender}, () => generalLimit(req, res, next));
}

// Must be used AFTER authenticate().
// Pass one or more roles that are allowed to access the route.
// Example: requireRole("ADMIN") or requireRole("ADMIN", "USER")
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }

    next();
  };
}
