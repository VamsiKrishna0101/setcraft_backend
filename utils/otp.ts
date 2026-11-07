import crypto from "crypto";
import redis from "../config/redis";
import { sendEmail } from "../config/brevo";
import {
  buildVerificationEmail,
  OTP_EXPIRY_MINUTES,
} from "./verification_email";

const OTP_TTL = OTP_EXPIRY_MINUTES * 60;
const VERIFIED_TTL = 300;

export function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

export async function storeAndSendOtp(email: string) {
  const otp = generateOtp();
  await redis.set(`otp:${email}`, JSON.stringify({ otp, attempts: 0 }), {
    ex: OTP_TTL,
  });
  const message = buildVerificationEmail(otp);
  await sendEmail(email, message.subject, message.html, message.text);
}

export async function verifyOtp(email: string, otp: string) {
  const raw = await redis.get<string>(`otp:${email}`);
  if (!raw) throw new Error("OTP expired or not found");

  const data =
    typeof raw === "string"
      ? JSON.parse(raw)
      : (raw as { otp: string; attempts: number });

  if (data.attempts >= 5) throw new Error("Too many attempts");

  if (data.otp !== otp) {
    await redis.set(
      `otp:${email}`,
      JSON.stringify({ ...data, attempts: data.attempts + 1 }),
      { ex: OTP_TTL },
    );
    throw new Error("Invalid OTP");
  }

  await redis.del(`otp:${email}`);
  await redis.set(`verified:${email}`, "true", { ex: VERIFIED_TTL });
}

export async function isEmailVerified(email: string) {
  const val = await redis.get(`verified:${email}`);
  return val === true || val === "true";
}

export async function clearVerified(email: string) {
  await redis.del(`verified:${email}`);
}
