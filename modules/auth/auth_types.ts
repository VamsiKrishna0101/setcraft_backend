import { z } from "zod";
import { OnboardingResponse } from "../onboarding/onboarding_types";
import { createOnboardingSchema } from "../onboarding/onboarding_types";

export const SendOtpSchema = z.object({
    email: z.email("Invalid email address"),
});

export const VerifyOtpSchema = z.object({
    email: z.email("Invalid email address"),
    otp: z.string().length(6, "OTP must be 6 digits"),
});

export const RegisterSchema = z.object({
    email: z.email("Invalid email address"),
    password: z.string().min(8, "Password should be at least 8 characters"),
    onboarding: createOnboardingSchema,
});

export const LoginSchema = z.object({
    email: z.email("Invalid email address"),
    password: z.string().min(8, "Password should be at least 8 characters"),
});

export const ResendOtpSchema = z.object({
    email: z.email("Invalid email address"),
});

export const RefreshTokenSchema = z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
});

export type SendOtpInput = z.infer<typeof SendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

export interface AuthResponse {
    user: {
        id: string;
        email: string;
        isVerified: boolean;
    };
    tokens: {
        accessToken: string;
        refreshToken: string;
    };
    onboarding: OnboardingResponse | null;
}
