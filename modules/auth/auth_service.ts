import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../config/prisma";
import { storeAndSendOtp, verifyOtp as checkOtp, isEmailVerified, clearVerified } from "../../utils/otp";
import { RegisterInput, AuthResponse, SendOtpInput, VerifyOtpInput, LoginInput } from "./auth_types";
import redis from "../../config/redis";
import { equipmentCategories } from '../onboarding/equipment_catalog';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const SALT_ROUNDS = 12;

export function generateTokens(userId: string, email: string) {
    const accessToken = jwt.sign({ userId, email }, JWT_ACCESS_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
    return { accessToken, refreshToken };
}

export async function refreshSession(refreshToken: string) {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.userId !== 'string' || 'email' in payload) {
        throw new Error('Invalid refresh session');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, email: true } });
    if (!user) throw new Error('Invalid refresh session');
    // Keep the original seven-day refresh lifetime; this does not extend it.
    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_ACCESS_SECRET, { expiresIn: '15m' });
    return { tokens: { accessToken, refreshToken } };
}

export async function sendOtp({ email }: SendOtpInput) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new Error("Email already in use");
    await storeAndSendOtp(email);
}

export async function verifyOtp({ email, otp }: VerifyOtpInput) {
    await checkOtp(email, otp);
}

export async function registerUser(input: RegisterInput): Promise<AuthResponse> {
    const { email, password, onboarding } = input;

    const verified = await isEmailVerified(email);
    if (!verified) throw new Error("Email not verified");

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new Error("User already exists");

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const { user, onboardingData } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: { email, password: hashedPassword, isVerified: true },
            select: { id: true, email: true, isVerified: true },
        });

        const onboardingData = await tx.onboarding.create({
            data: { userId: user.id, ...onboarding,
                ...(onboarding.equipmentIds ? {equipment: equipmentCategories(onboarding.equipmentIds)} : {}) },
        });


        return { user, onboardingData };
    });

    await clearVerified(email);

    const tokens = generateTokens(user.id, user.email);

    return {
        user: { id: user.id, email: user.email, isVerified: user.isVerified },
        tokens,
        onboarding: onboardingData,
    };
}

export async function getUserDetails(userId: string) {
    const cached = await redis.get(`user:${userId}`);
    if (cached) return cached;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            isVerified: true,
            onboarding: true,
        },
    });

    if (user) {
        await redis.set(`user:${userId}`, user, { ex: 60 * 60 * 24 * 30 });
    }

    return user;
}


export async function Loginuser(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    const user = await prisma.user.findUnique({
        where: { email },
        include: { onboarding: true },
    });

    if (!user) {
        throw new Error("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        throw new Error("Invalid email or password");
    }

    const tokens = generateTokens(user.id, user.email);

    const userProfile = {
        id: user.id,
        email: user.email,
        isVerified: user.isVerified,
        onboarding: user.onboarding,
    };

    await redis.set(`user:${user.id}`, userProfile, { ex: 60 * 60 * 24 * 30 });

    return {
        user: {
            id: user.id,
            email: user.email,
            isVerified: user.isVerified,
        },
        tokens,
        onboarding: user.onboarding,
    };
}
