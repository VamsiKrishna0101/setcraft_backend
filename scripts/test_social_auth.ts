import 'dotenv/config';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { DecodedIdToken } from 'firebase-admin/auth';
import prisma from '../config/prisma';
import { exchangeSocialToken, SocialExchangeSchema, validateSocialClaims } from '../modules/auth/social_auth_service';
import { rateLimits } from '../middleware/rate_limit';

async function main() {
  const enabled = process.env.SOCIAL_AUTH_ENABLED;
  const lookup = prisma.authIdentity.findUnique;
  const transaction = prisma.$transaction;
  const claims = {
    uid: 'synthetic-firebase-uid', sub: 'synthetic-firebase-uid',
    email: 'SYNTHETIC@example.test', email_verified: true,
    auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: 'google.com', identities: {} },
  } as DecodedIdToken;
  const verify = async () => claims;
  let queries = 0;
  const user = { id: 'synthetic-user', email: 'synthetic@example.test', isVerified: true, onboarding: null };
  try {
    process.env.SOCIAL_AUTH_ENABLED = 'false';
    await assert.rejects(exchangeSocialToken('synthetic', async () => { throw new Error('Must not verify'); }), /not available yet/);
    process.env.SOCIAL_AUTH_ENABLED = 'true';
    (prisma.authIdentity as any).findUnique = async () => { queries++; return null; };
    (prisma as any).$transaction = async (fn: any) => fn({
      user: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          assert.equal(data.email, user.email);
          assert.equal(data.authIdentities.create.firebaseUid, claims.uid);
          assert.match(data.password, /^\$2[aby]\$12\$/);
          assert.equal(data.isVerified, true);
          assert.equal('trialStartedAt' in data, false);
          assert.equal('subscriptions' in data, false);
          return user;
        },
      },
    });
    const result = await exchangeSocialToken('synthetic', verify);
    assert.equal(result.user.id, user.id);
    assert.equal((jwt.verify(result.tokens.accessToken, process.env.JWT_ACCESS_SECRET!) as jwt.JwtPayload).userId, user.id);
    const beforeInvalid = queries;
    await assert.rejects(exchangeSocialToken('synthetic', async () => ({ ...claims, firebase: { identities: {}, sign_in_provider: 'password' } })), /again/);
    assert.equal(queries, beforeInvalid);
    assert.throws(() => validateSocialClaims({ ...claims, auth_time: claims.auth_time - 601 }), /again/);
    assert.throws(() => validateSocialClaims({ ...claims, auth_time: claims.auth_time + 120 }), /again/);
    assert.throws(() => validateSocialClaims({ ...claims, sub: 'other' }), /again/);
    await assert.rejects(exchangeSocialToken('synthetic', async () => ({ ...claims, email_verified: false })), /verified email/);
    (prisma as any).$transaction = async (fn: any) => fn({ user: { findFirst: async () => ({ id: 'existing-email-owner' }) } });
    await assert.rejects(exchangeSocialToken('synthetic', verify), /existing account/);
    // Stable UID, rather than an email supplied by the client, identifies a return visit.
    (prisma.authIdentity as any).findUnique = async () => ({ user });
    assert.equal((await exchangeSocialToken('synthetic', async () => ({ ...claims, email: undefined, email_verified: undefined }))).user.id, user.id);
    assert.equal(SocialExchangeSchema.safeParse({ idToken: 'x'.repeat(9000) }).success, false);
    assert.equal(SocialExchangeSchema.safeParse({ idToken: 'x'.repeat(100), email: 'forged@example.test' }).success, false);
    assert.equal(rateLimits.socialAuth.strict, true);
    console.log('Social auth checks passed: default-off, claims, fresh login, stable identity, no implicit linking, no trial grants, bounded input, rate limiting. No database writes or token logging.');
  } finally {
    if (enabled === undefined) delete process.env.SOCIAL_AUTH_ENABLED;
    else process.env.SOCIAL_AUTH_ENABLED = enabled;
    prisma.authIdentity.findUnique = lookup;
    prisma.$transaction = transaction;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
