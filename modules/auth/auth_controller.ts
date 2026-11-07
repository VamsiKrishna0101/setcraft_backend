import { Request, Response, NextFunction } from "express";
import {
  sendOtp,
  verifyOtp,
  registerUser,
  Loginuser,
  getUserDetails,
  refreshSession,
} from "./auth_service";
import {
  SendOtpSchema,
  VerifyOtpSchema,
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
} from "./auth_types";

export async function handleSendOtp(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = SendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await sendOtp(parsed.data);
    res.json({ message: "OTP sent" });
  } catch (e) {
    next(e);
  }
}

export async function handleVerifyOtp(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = VerifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await verifyOtp(parsed.data);
    res.json({ message: "OTP verified" });
  } catch (e) {
    next(e);
  }
}

export async function handleRegister(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await registerUser(parsed.data);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function handleLogin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await Loginuser(parsed.data);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function handleGetUserDetails(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { userId } = req.params;
  if (!req.user || userId !== req.user.userId) {
    res.status(403).json({ error: "You can only access your own profile." });
    return;
  }
  try {
    const user = await getUserDetails(req.user.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json(user);
  } catch (e) {
    next(e);
  }
}

export async function handleRefresh(req: Request, res: Response) {
  const parsed = RefreshTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Refresh token is required" });
    return;
  }
  try {
    res.json(await refreshSession(parsed.data.refreshToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}
