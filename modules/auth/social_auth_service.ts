import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DecodedIdToken } from 'firebase-admin/auth';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { firebaseAuthentication } from '../../config/firebase';
import { generateTokens } from './auth_service';

export const SocialExchangeSchema = z.object({
  idToken: z.string().min(40).max(8192),
}).strict();

export class SocialAuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateSocialClaims(claims: DecodedIdToken, now = Date.now()) {
  const provider = claims.firebase?.sign_in_provider;
  if (!['google.com', 'apple.com'].includes(provider) ||
      !claims.uid || claims.uid.length > 128 || claims.sub !== claims.uid ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time * 1000 > now + 60_000 ||
      now - claims.auth_time * 1000 > 10 * 60_000) {
    throw new SocialAuthError(401, 'Please sign in with Apple or Google again');
  }
  return claims;
}

export async function verifySocialToken(idToken: string) {
  const auth = firebaseAuthentication();
  if (!auth) throw new SocialAuthError(503, 'Social sign-in is not available yet — continue with email');
  try {
    // Firebase checks issuer, project audience, expiry, signature and revocation.
    return validateSocialClaims(await auth.verifyIdToken(idToken, true));
  } catch (error) {
    if (error instanceof SocialAuthError) throw error;
    throw new SocialAuthError(401, 'Please sign in with Apple or Google again');
  }
}

export async function exchangeSocialToken(
  idToken: string,
  verify: (token: string) => Promise<DecodedIdToken> = verifySocialToken,
) {
  if (process.env.SOCIAL_AUTH_ENABLED !== 'true') {
    throw new SocialAuthError(503, 'Social sign-in is not available yet — continue with email');
  }
  const claims = validateSocialClaims(await verify(idToken));
  const existing = await prisma.authIdentity.findUnique({
    where: { firebaseUid: claims.uid }, include: { user: { include: { onboarding: true } } },
  });
  let user = existing?.user;
  if (!user) {
    const email = claims.email?.trim().toLowerCase();
    if (claims.email_verified !== true || !z.email().safeParse(email).success) {
      throw new SocialAuthError(401, 'A verified email is required — continue with email');
    }
    // Social accounts have no usable password; never use a provider token as one.
    const password = await bcrypt.hash(randomBytes(48).toString('base64url'), 12);
    try {
      user = await prisma.$transaction(async tx => {
        // A matching email alone never links a new provider to an existing account.
        const owner = await tx.user.findFirst({
          where: { email: { equals: email!, mode: 'insensitive' } }, select: { id: true },
        });
        if (owner) throw new SocialAuthError(409, 'Please sign in with email to use your existing account');
        return tx.user.create({
          data: { email: email!, password, isVerified: true,
            authIdentities: { create: { firebaseUid: claims.uid } } },
          include: { onboarding: true },
        });
      });
    } catch (error) {
      // Two successful taps can race. Only recover the same verified identity.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await prisma.authIdentity.findUnique({
        where: { firebaseUid: claims.uid }, include: { user: { include: { onboarding: true } } },
      });
      if (!raced) throw new SocialAuthError(409, 'Please sign in with email to use your existing account');
      user = raced.user;
    }
  }
  return {
    user: { id: user.id, email: user.email, isVerified: user.isVerified },
    tokens: generateTokens(user.id, user.email),
    onboarding: user.onboarding,
  };
}
